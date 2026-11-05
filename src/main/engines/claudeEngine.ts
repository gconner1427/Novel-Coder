// Claude engine: drives Claude Code through the Claude Agent SDK, using the user's `claude` login
// (Claude Pro/Max subscription). Long-lived streaming-input session per conversation.
import fs from 'node:fs'
import path from 'node:path'
import { query, type Query, type SDKMessage, type SDKUserMessage, type PermissionMode as ClaudeMode, type PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { EngineEvent, PermissionMode, PermissionResponse, SendOptions } from '@shared/types'
import { AsyncQueue, type Emit, type Engine, type EngineStartOptions, mcpServerSpec, readFileOrUndefined, resolvePackageFile, SAFE_NOVEL_TOOLS } from './engine'
import { BRAINSTORM_SYSTEM_APPEND, NOVEL_SYSTEM_APPEND, SUBAGENTS } from './prompts'

const MODE_MAP: Record<PermissionMode, ClaudeMode> = {
  ask: 'default',
  acceptEdits: 'acceptEdits',
  plan: 'plan',
  auto: 'bypassPermissions'
}

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'mcp__novel__scene_write'])

interface Pending {
  resolve: (r: { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] } | { behavior: 'deny'; message: string }) => void
  input: Record<string, unknown>
  suggestions?: PermissionUpdate[]
  tool: string
}

export class ClaudeEngine implements Engine {
  readonly id = 'claude' as const
  private q: Query
  private input = new AsyncQueue<SDKUserMessage>()
  private emit: Emit
  private root: string
  private pending = new Map<string, Pending>()
  private fileBefore = new Map<string, { path: string; before?: string }>()
  private curMsg = ''
  private blockKinds = new Map<number, string>()
  private _busy = false
  private sessionId = ''
  private closed = false
  private mode: PermissionMode

  get busy() {
    return this._busy
  }

  constructor(opts: EngineStartOptions) {
    this.emit = opts.emit
    this.root = opts.root
    this.mode = opts.settings.permissionMode
    const exe = resolvePackageFile('@anthropic-ai/claude-agent-sdk-win32-x64', 'claude.exe')
    const model = opts.settings.model && opts.settings.model !== 'default' ? opts.settings.model : undefined
    const brainstorm = opts.mode === 'brainstorm'
    this.q = query({
      prompt: this.input,
      options: {
        cwd: opts.root,
        model,
        resume: opts.resumeSessionId,
        pathToClaudeCodeExecutable: exe,
        includePartialMessages: true,
        settingSources: ['user', 'project'],
        systemPrompt: { type: 'preset', preset: 'claude_code', append: brainstorm ? BRAINSTORM_SYSTEM_APPEND : NOVEL_SYSTEM_APPEND },
        permissionMode: MODE_MAP[opts.settings.permissionMode],
        allowDangerouslySkipPermissions: true,
        additionalDirectories: opts.extraDirs,
        allowedTools: brainstorm ? [] : SAFE_NOVEL_TOOLS.map((t) => `mcp__novel__${t}`),
        mcpServers: brainstorm ? {} : { novel: { type: 'stdio', ...mcpServerSpec(opts.root) } },
        agents: brainstorm ? undefined : Object.fromEntries(Object.entries(SUBAGENTS).map(([k, v]) => [k, { description: v.description, prompt: v.prompt, tools: v.tools }])),
        effort: (opts.settings.effort as never) || undefined,
        canUseTool: (toolName, input, { suggestions, signal }) =>
          new Promise((resolve) => {
            // Brainstorm workspaces are scratch folders: let the AI keep ideas.md current without prompting.
            if (brainstorm && ['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
              const p = path.resolve(opts.root, String(input.file_path ?? ''))
              if (p.startsWith(path.resolve(opts.root) + path.sep)) return resolve({ behavior: 'allow', updatedInput: input })
            }
            // "Auto-accept edits" also covers our own novel tools (they only edit project files, which are snapshotted).
            if (this.mode === 'acceptEdits' && toolName.startsWith('mcp__novel__')) return resolve({ behavior: 'allow', updatedInput: input })
            const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            const kind = toolName === 'ExitPlanMode' ? 'plan' : toolName === 'AskUserQuestion' ? 'question' : 'tool'
            this.pending.set(requestId, { resolve: resolve as Pending['resolve'], input, suggestions, tool: toolName })
            signal.addEventListener('abort', () => {
              if (this.pending.delete(requestId)) resolve({ behavior: 'deny', message: 'Aborted' })
            })
            this.emit({ type: 'permission', requestId, tool: toolName, input, kind })
          }),
        stderr: (d: string) => {
          if (/error/i.test(d)) console.error('[claude]', d)
        }
      }
    })
    void this.pump()
  }

  private async pump() {
    try {
      for await (const m of this.q) this.handle(m)
    } catch (e) {
      if (!this.closed) this.emit({ type: 'error', message: friendlyError((e as Error).message) })
    } finally {
      this._busy = false
      if (!this.closed) this.emit({ type: 'done', isError: true, result: 'Claude session ended.' })
    }
  }

  private handle(m: SDKMessage) {
    switch (m.type) {
      case 'system': {
        if (m.subtype === 'init') {
          this.sessionId = m.session_id
          this.emit({ type: 'session', engine: 'claude', sessionId: m.session_id, model: m.model, tools: m.tools })
          this.q
            .supportedModels()
            .then((ms) => this.emit({ type: 'session', engine: 'claude', sessionId: this.sessionId, model: m.model, models: ms.map((x) => x.value) }))
            .catch(() => {})
        } else if ((m as { subtype: string }).subtype === 'compact_boundary') {
          this.emit({ type: 'status', text: 'Conversation compacted.' })
        }
        return
      }
      case 'stream_event': {
        if (m.parent_tool_use_id) return
        const ev = m.event as { type: string; index?: number; message?: { id: string }; content_block?: { type: string }; delta?: { type: string; text?: string; thinking?: string } }
        if (ev.type === 'message_start' && ev.message) {
          this.curMsg = ev.message.id
          this.blockKinds.clear()
        } else if (ev.type === 'content_block_start' && ev.content_block) {
          this.blockKinds.set(ev.index ?? 0, ev.content_block.type)
        } else if (ev.type === 'content_block_delta' && ev.delta) {
          const id = `${this.curMsg}-${ev.index ?? 0}`
          if (ev.delta.type === 'text_delta' && ev.delta.text) this.emit({ type: 'text-delta', messageId: id, text: ev.delta.text })
          else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) this.emit({ type: 'thinking', messageId: id, text: ev.delta.thinking, delta: true })
        }
        return
      }
      case 'assistant': {
        if (m.error) this.emit({ type: 'error', message: friendlyError(m.error) })
        for (const b of m.message.content as { type: string; id?: string; name?: string; input?: Record<string, unknown> }[]) {
          if (b.type !== 'tool_use' || !b.id || !b.name) continue
          this.emit({ type: 'tool-start', toolId: b.id, name: b.name, input: b.input, parentToolId: m.parent_tool_use_id })
          if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
            this.emit({
              type: 'todos',
              items: (b.input!.todos as { content: string; status: 'pending' | 'in_progress' | 'completed' }[]).map((t) => ({ text: t.content, status: t.status }))
            })
          }
          if (FILE_TOOLS.has(b.name)) {
            const p = String(b.input?.file_path ?? b.input?.notebook_path ?? b.input?.path ?? '')
            if (p) {
              const abs = path.isAbsolute(p) ? p : path.join(this.root, p)
              this.fileBefore.set(b.id, { path: abs, before: readFileOrUndefined(abs) })
            }
          }
        }
        return
      }
      case 'user': {
        const content = m.message.content
        if (!Array.isArray(content)) return
        for (const b of content as { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) {
          if (b.type !== 'tool_result' || !b.tool_use_id) continue
          this.emit({ type: 'tool-end', toolId: b.tool_use_id, output: toolText(b.content), isError: b.is_error })
          const fb = this.fileBefore.get(b.tool_use_id)
          if (fb) {
            this.fileBefore.delete(b.tool_use_id)
            const after = readFileOrUndefined(fb.path)
            if (!b.is_error && after !== fb.before) {
              this.emit({
                type: 'file-change',
                toolId: b.tool_use_id,
                path: path.relative(this.root, fb.path).split(path.sep).join('/'),
                kind: fb.before === undefined ? 'add' : after === undefined ? 'delete' : 'update',
                before: fb.before,
                after
              })
            }
          }
        }
        return
      }
      case 'result': {
        this._busy = false
        const u = (m as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } }).usage
        if (u) {
          this.emit({
            type: 'usage',
            inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
            outputTokens: u.output_tokens ?? 0,
            costUsd: (m as { total_cost_usd?: number }).total_cost_usd
          })
        }
        const isError = m.subtype !== 'success'
        this.emit({ type: 'done', isError, result: isError ? `Turn ended: ${m.subtype}` : undefined })
        return
      }
      default:
        return
    }
  }

  async send(msg: SendOptions) {
    const content: unknown[] = []
    for (const img of msg.images ?? []) {
      try {
        const data = fs.readFileSync(img).toString('base64')
        const ext = path.extname(img).slice(1).toLowerCase()
        const media = ext === 'jpg' ? 'jpeg' : ext
        content.push({ type: 'image', source: { type: 'base64', media_type: `image/${media}`, data } })
      } catch {
        /* skip unreadable image */
      }
    }
    content.push({ type: 'text', text: msg.text })
    this._busy = true
    this.emit({ type: 'turn-start' })
    this.input.push({ type: 'user', message: { role: 'user', content: content as never }, parent_tool_use_id: null } as SDKUserMessage)
  }

  async interrupt() {
    for (const [id, p] of this.pending) {
      p.resolve({ behavior: 'deny', message: 'Interrupted by user' })
      this.pending.delete(id)
    }
    await this.q.interrupt().catch(() => {})
  }

  async setPermissionMode(mode: PermissionMode) {
    this.mode = mode
    await this.q.setPermissionMode(MODE_MAP[mode]).catch(() => {})
  }

  async setModel(model: string) {
    await this.q.setModel(model === 'default' ? undefined : model).catch(() => {})
  }

  respondPermission(r: PermissionResponse) {
    const p = this.pending.get(r.requestId)
    if (!p) return
    this.pending.delete(r.requestId)
    if (r.decision === 'deny') {
      p.resolve({ behavior: 'deny', message: r.message || 'The author declined this action.' })
      return
    }
    if (p.tool === 'AskUserQuestion') {
      p.resolve({ behavior: 'allow', updatedInput: { ...p.input, answers: r.answers ?? {} } })
      return
    }
    p.resolve({
      behavior: 'allow',
      updatedInput: p.input,
      updatedPermissions: r.decision === 'allowAlways' ? p.suggestions : undefined
    })
  }

  close() {
    this.closed = true
    this.input.close()
    try {
      this.q.close()
    } catch {
      /* ignore */
    }
  }
}

function toolText(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((x) => (x && typeof x === 'object' && 'text' in x ? String((x as { text: string }).text) : x?.type === 'image' ? '[image]' : '')).join('\n')
  return c == null ? '' : JSON.stringify(c)
}

function friendlyError(msg: string): string {
  if (/authentication|login|401|oauth/i.test(msg)) return `Claude isn't logged in (${msg}). Open Settings → Accounts and click "Log in to Claude".`
  if (/rate_limit|usage limit/i.test(msg)) return `Claude usage limit reached for your plan (${msg}). Try again later or switch to Codex.`
  return msg
}

export type { EngineEvent }
