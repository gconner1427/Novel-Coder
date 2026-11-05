// Codex engine: drives OpenAI Codex through @openai/codex-sdk, using the user's `codex login`
// (ChatGPT Plus/Pro subscription). One Codex thread per conversation; each send is one turn.
import path from 'node:path'
import { Codex, type Thread, type ThreadEvent, type ThreadItem, type ThreadOptions } from '@openai/codex-sdk'
import type { PermissionMode, PermissionResponse, SendOptions } from '@shared/types'
import { createSnapshot, fileAtSnapshot } from '@shared/snapshots'
import { type Emit, type Engine, type EngineStartOptions, mcpServerSpec, readFileOrUndefined, resolvePackageFile } from './engine'
import { BRAINSTORM_SYSTEM_APPEND, NOVEL_SYSTEM_APPEND, SUBAGENTS } from './prompts'

const PLAN_PREFIX =
  'PLAN MODE: Do not modify any files. Research the project as needed, then reply with a clear, numbered plan for the author to approve.\n\n'

export class CodexEngine implements Engine {
  readonly id = 'codex' as const
  private codex: Codex
  private thread: Thread
  private emit: Emit
  private root: string
  private mode: PermissionMode
  private model: string
  private effort?: string
  private abort?: AbortController
  private _busy = false
  private firstTurn: boolean
  private announcedSession = false
  private brainstorm: boolean
  private extraDirs?: string[]

  get busy() {
    return this._busy
  }

  constructor(opts: EngineStartOptions) {
    this.emit = opts.emit
    this.root = opts.root
    this.mode = opts.settings.permissionMode
    this.model = opts.settings.model
    this.effort = opts.settings.effort
    this.firstTurn = !opts.resumeSessionId
    this.brainstorm = opts.mode === 'brainstorm'
    this.extraDirs = opts.extraDirs
    const mcp = mcpServerSpec(opts.root)
    const packaged = import.meta.dirname.includes('app.asar')
    this.codex = new Codex({
      codexPathOverride: packaged ? resolvePackageFile('@openai/codex-win32-x64', 'vendor/x86_64-pc-windows-msvc/bin/codex.exe') : undefined,
      // Our own trusted server: pre-approve its tools (Codex otherwise rejects MCP calls under approval "never").
      config: this.brainstorm
        ? {}
        : { mcp_servers: { novel: { command: mcp.command, args: mcp.args, env: mcp.env, default_tools_approval_mode: 'approve' } } }
    })
    this.thread = opts.resumeSessionId
      ? this.codex.resumeThread(opts.resumeSessionId, this.threadOptions())
      : this.codex.startThread(this.threadOptions())
    if (opts.resumeSessionId) this.emitSession(opts.resumeSessionId)
  }

  private threadOptions(): ThreadOptions {
    return {
      workingDirectory: this.root,
      additionalDirectories: this.extraDirs,
      skipGitRepoCheck: true,
      model: this.model && this.model !== 'default' ? this.model : undefined,
      modelReasoningEffort: (this.effort as ThreadOptions['modelReasoningEffort']) || undefined,
      sandboxMode: this.mode === 'plan' ? 'read-only' : this.mode === 'auto' ? 'danger-full-access' : 'workspace-write',
      approvalPolicy: 'never',
      webSearchMode: 'live',
      networkAccessEnabled: this.mode === 'auto'
    }
  }

  private emitSession(id: string) {
    this.announcedSession = true
    this.emit({ type: 'session', engine: 'codex', sessionId: id, model: this.model })
  }

  /** Re-open the same thread with new options (model / sandbox changes). */
  private reopen() {
    const id = this.thread.id
    if (id) this.thread = this.codex.resumeThread(id, this.threadOptions())
    else this.thread = this.codex.startThread(this.threadOptions())
  }

  async send(msg: SendOptions) {
    if (this._busy) {
      this.emit({ type: 'status', text: 'Codex is still working; your message will be sent when it finishes.' })
      while (this._busy) await new Promise((r) => setTimeout(r, 250))
    }
    this._busy = true
    this.emit({ type: 'turn-start' })
    // Codex has no per-tool approval callback in the SDK, so we checkpoint before every turn
    // (Rewind restores it) and use that checkpoint to show before/after diffs.
    const snap = this.mode === 'plan' || this.brainstorm ? null : await createSnapshot(this.root, 'Before Codex turn').catch(() => null)
    const snapRef = snap ?? 'HEAD'

    let text = msg.text
    if (this.firstTurn && this.brainstorm) {
      text = `${BRAINSTORM_SYSTEM_APPEND}

---

${text}`
      this.firstTurn = false
    } else if (this.firstTurn) {
      const agents = Object.entries(SUBAGENTS)
        .map(([k, v]) => `- ${k}: ${v.description}\n  Approach: ${v.prompt}`)
        .join('\n')
      text = `${NOVEL_SYSTEM_APPEND}\n\n## Editorial roles you can adopt when asked\n${agents}\n\n---\n\n${text}`
      this.firstTurn = false
    }
    if (this.mode === 'plan') text = PLAN_PREFIX + text

    const input = msg.images?.length
      ? [{ type: 'text' as const, text }, ...msg.images.map((p) => ({ type: 'local_image' as const, path: p }))]
      : text

    this.abort = new AbortController()
    try {
      const { events } = await this.thread.runStreamed(input, { signal: this.abort.signal })
      for await (const ev of events) await this.handle(ev, snapRef)
    } catch (e) {
      const m = (e as Error).message ?? String(e)
      if (!/abort/i.test(m)) this.emit({ type: 'error', message: friendlyError(m) })
      this.emit({ type: 'done', isError: true })
    } finally {
      this._busy = false
      this.abort = undefined
    }
  }

  private async handle(ev: ThreadEvent, snapRef: string) {
    switch (ev.type) {
      case 'thread.started':
        if (!this.announcedSession) this.emitSession(ev.thread_id)
        return
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        return this.item(ev.item, ev.type === 'item.completed', ev.type === 'item.started', snapRef)
      case 'turn.completed':
        this.emit({ type: 'usage', inputTokens: ev.usage.input_tokens, outputTokens: ev.usage.output_tokens + ev.usage.reasoning_output_tokens })
        this.emit({ type: 'done' })
        return
      case 'turn.failed':
        this.emit({ type: 'error', message: friendlyError(ev.error.message) })
        this.emit({ type: 'done', isError: true })
        return
      case 'error':
        this.emit({ type: 'error', message: friendlyError(ev.message) })
        return
    }
  }

  private seen = new Set<string>()

  private async item(item: ThreadItem, completed: boolean, started: boolean, snapRef: string) {
    const startOnce = (name: string, input: unknown) => {
      if (this.seen.has(item.id)) return
      this.seen.add(item.id)
      this.emit({ type: 'tool-start', toolId: item.id, name, input })
    }
    switch (item.type) {
      case 'agent_message':
        this.emit({ type: 'text', messageId: item.id, text: item.text })
        return
      case 'reasoning':
        if (item.text) this.emit({ type: 'thinking', messageId: item.id, text: item.text })
        return
      case 'command_execution':
        startOnce('Bash', { command: item.command })
        if (completed) this.emit({ type: 'tool-end', toolId: item.id, output: item.aggregated_output, isError: item.status === 'failed' || (item.exit_code ?? 0) !== 0 })
        return
      case 'mcp_tool_call':
        startOnce(`mcp__${item.server}__${item.tool}`, item.arguments)
        if (completed) {
          const out = item.error?.message ?? (item.result?.content ?? []).map((c) => ('text' in c ? c.text : `[${c.type}]`)).join('\n')
          this.emit({ type: 'tool-end', toolId: item.id, output: out, isError: item.status === 'failed' })
        }
        return
      case 'web_search':
        startOnce('WebSearch', { query: item.query })
        if (completed) this.emit({ type: 'tool-end', toolId: item.id, output: 'Search complete.' })
        return
      case 'file_change': {
        startOnce('Edit', { files: item.changes.map((c) => `${c.kind}: ${c.path}`) })
        if (!completed) return
        for (const c of item.changes) {
          const abs = path.isAbsolute(c.path) ? c.path : path.join(this.root, c.path)
          const rel = path.relative(this.root, abs).split(path.sep).join('/')
          const before = (await fileAtSnapshot(this.root, snapRef, rel)) ?? undefined
          this.emit({ type: 'file-change', toolId: item.id, path: rel, kind: c.kind, before, after: readFileOrUndefined(abs) })
        }
        this.emit({ type: 'tool-end', toolId: item.id, output: item.changes.map((c) => `${c.kind} ${c.path}`).join('\n'), isError: item.status === 'failed' })
        return
      }
      case 'todo_list':
        this.emit({
          type: 'todos',
          items: item.items.map((t, i) => ({
            text: t.text,
            status: t.completed ? 'completed' : i === item.items.findIndex((x) => !x.completed) ? 'in_progress' : 'pending'
          }))
        })
        return
      case 'error':
        this.emit({ type: 'status', text: item.message })
        return
    }
    void started
  }

  async interrupt() {
    this.abort?.abort()
  }

  async setPermissionMode(mode: PermissionMode) {
    this.mode = mode
    this.reopen()
  }

  async setModel(model: string) {
    this.model = model
    this.reopen()
  }

  respondPermission(_r: PermissionResponse) {
    /* Codex SDK runs non-interactively; no permission callbacks. */
  }

  close() {
    this.abort?.abort()
  }
}

function friendlyError(msg: string): string {
  if (/login|unauthori[sz]ed|401|auth/i.test(msg)) return `Codex isn't logged in (${msg}). Open Settings → Accounts and click "Log in to ChatGPT".`
  if (/usage limit|rate limit|429/i.test(msg)) return `Codex usage limit reached for your ChatGPT plan (${msg}). Try again later or switch to Claude.`
  return msg
}
