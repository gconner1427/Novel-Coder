import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { CodexCatalog, CodexModel } from '@shared/types'
import { resolvePackageFile } from '../engines/engine'
import pkg from '../../../package.json'

/** Login, discovery, and inference must all use the bundled SDK's native runtime. */
export function codexExe(): string | undefined {
  return resolvePackageFile('@openai/codex-win32-x64', 'vendor/x86_64-pc-windows-msvc/bin/codex.exe')
}

/** A short-lived, metadata-only app-server connection. Never returns credentials. */
async function withRuntime<T>(cwd: string | undefined, read: (request: <R>(method: string, params?: unknown) => Promise<R>) => Promise<T>): Promise<T> {
  const exe = codexExe()
  if (!exe) throw new Error('The bundled Codex runtime was not found. Reinstall Novel Coder.')
  const child = spawn(exe, ['app-server', '--listen', 'stdio://'], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()))
  const lines = createInterface({ input: child.stdout })
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  let nextId = 0
  let failure: Error | undefined
  const fail = (error: Error) => {
    failure = error
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  }
  const request = <R>(method: string, params: unknown = {}): Promise<R> => {
    if (failure) return Promise.reject(failure)
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: (value) => resolve(value as R), reject })
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }
  lines.on('line', (line) => {
    let message: { id: number; result?: unknown; error?: { message?: string } }
    try { message = JSON.parse(line) } catch { return }
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(message.error.message ?? 'Codex metadata request failed'))
    else waiter.resolve(message.result)
  })
  child.stderr.resume()
  child.on('error', fail)
  child.stdin.on('error', fail)
  child.on('exit', () => fail(new Error('Codex exited while reading its setup.')))
  const timeout = setTimeout(() => {
    fail(new Error('Codex took too long to report its setup. Try refreshing.'))
    child.kill()
  }, 15000)
  try {
    await request('initialize', { clientInfo: { name: 'novel_coder', title: 'Novel Coder', version: pkg.version } })
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
    return await read(request)
  } finally {
    clearTimeout(timeout)
    lines.close()
    child.stdin.end()
    child.kill()
    await exited
  }
}

interface ModelPage {
  data: (CodexModel & { model: string; hidden?: boolean })[]
  nextCursor: string | null
}

export function getCodexCatalog(cwd?: string): Promise<CodexCatalog> {
  return withRuntime(cwd, async (request) => {
    const [first, config] = await Promise.all([
      request<ModelPage>('model/list', { limit: 100, includeHidden: false }),
      request<{ config: { model?: string | null; model_reasoning_effort?: string | null } }>('config/read', { cwd })
    ])
    const entries = [...first.data]
    let cursor = first.nextCursor
    const cursors = new Set<string>()
    while (cursor && !cursors.has(cursor)) {
      cursors.add(cursor)
      const page = await request<ModelPage>('model/list', { limit: 100, includeHidden: false, cursor })
      entries.push(...page.data)
      cursor = page.nextCursor
    }
    const models = entries.filter((m) => !m.hidden).map((m) => ({
      id: m.model || m.id,
      displayName: m.displayName,
      description: m.description,
      defaultReasoningEffort: m.defaultReasoningEffort,
      supportedReasoningEfforts: m.supportedReasoningEfforts,
      isDefault: m.isDefault
    }))
    return {
      models,
      defaultModel: config.config.model || models.find((m) => m.isDefault)?.id,
      configuredEffort: config.config.model_reasoning_effort || undefined
    }
  })
}

export function getCodexAccount(): Promise<{ loggedIn: boolean; detail: string }> {
  return withRuntime(undefined, async (request) => {
    const { account, requiresOpenaiAuth } = await request<{ account: { type: string } | null; requiresOpenaiAuth: boolean }>('account/read', { refreshToken: false })
    if (account?.type === 'apiKey') return { loggedIn: true, detail: 'Using an OpenAI API key (API billing)' }
    if (account) return { loggedIn: true, detail: 'Signed in with your ChatGPT account' }
    if (!requiresOpenaiAuth) return { loggedIn: true, detail: 'Using your configured Codex provider' }
    return { loggedIn: false, detail: 'Not signed in. Click "Log in" to connect your ChatGPT account.' }
  })
}
