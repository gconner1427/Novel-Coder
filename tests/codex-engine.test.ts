import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexCatalog, EngineEvent, EngineSettings } from '@shared/types'
import { codexAutoEffort, compatibleCodexEffort } from '@shared/codexModels'

const mock = vi.hoisted(() => ({
  clients: [] as any[],
  runs: [] as any[],
  catalog: vi.fn(),
  snapshot: vi.fn(async () => 'snapshot'),
  gate: null as Promise<void> | null,
  fatal: false
}))

vi.mock('../src/main/services/codexRuntime', () => ({ codexExe: () => 'codex-test.exe', getCodexCatalog: mock.catalog }))
vi.mock('@shared/snapshots', () => ({ createSnapshot: mock.snapshot, fileAtSnapshot: vi.fn() }))
vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    options: any
    constructor(options: any) { this.options = options; mock.clients.push(this) }
    startThread(options: any) { return this.makeThread(null, options) }
    resumeThread(id: string, options: any) { return this.makeThread(id, options) }
    makeThread(id: string | null, options: any) {
      const thread = {
        id,
        async runStreamed(input: unknown, turn: { signal: AbortSignal }) {
          mock.runs.push({ id: thread.id, options, input, turn })
          return { events: (async function* () {
            if (mock.gate) await mock.gate
            if (turn.signal.aborted) throw new Error('Aborted')
            if (!thread.id) { thread.id = 'thread-1'; yield { type: 'thread.started', thread_id: thread.id } }
            if (mock.fatal) { yield { type: 'error', message: 'Runtime failed' }; return }
            yield { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2, reasoning_output_tokens: 0 } }
          })() }
        }
      }
      return thread
    }
  }
}))

import { CodexEngine } from '../src/main/engines/codexEngine'

const catalog: CodexCatalog = {
  defaultModel: 'writing-model',
  models: [
    { id: 'writing-model', displayName: 'Writing', description: '', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: '' }, { reasoningEffort: 'high', description: '' }] },
    { id: 'quick-model', displayName: 'Quick', description: '', isDefault: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }] }
  ]
}

function setup(settings: Partial<EngineSettings> = {}) {
  const events: EngineEvent[] = []
  const engine = new CodexEngine({ root: process.cwd(), settings: { engine: 'codex', model: 'default', permissionMode: 'acceptEdits', ...settings }, emit: (e) => events.push(e) })
  return { engine, events }
}

beforeEach(() => {
  mock.clients.length = 0
  mock.runs.length = 0
  mock.catalog.mockResolvedValue(catalog)
  mock.snapshot.mockClear()
  mock.gate = null
  mock.fatal = false
})

describe('Codex settings and lifecycle', () => {
  it('restores the configured default model and auto effort in the same conversation', async () => {
    const { engine } = setup({ model: 'quick-model', effort: 'low' })
    await engine.send({ text: 'First' })
    await engine.setModel('default')
    await engine.setEffort('')
    await engine.send({ text: 'Second' })
    expect(mock.runs[1]).toMatchObject({ id: 'thread-1', options: { model: 'writing-model', modelReasoningEffort: 'medium' } })
  })

  it('keeps the thread when a setting changes before the first response', async () => {
    let release!: () => void
    mock.gate = new Promise<void>((r) => { release = r })
    const { engine } = setup()
    const running = engine.send({ text: 'First' })
    await vi.waitFor(() => expect(mock.runs).toHaveLength(1))
    await engine.setModel('quick-model')
    await engine.setEffort('low')
    release()
    await running
    mock.gate = null
    await engine.send({ text: 'Second' })
    expect(mock.runs[1]).toMatchObject({ id: 'thread-1', options: { model: 'quick-model', modelReasoningEffort: 'low' } })
  })

  it.each(['ask', 'plan'] as const)('%s mode restricts filesystem and MCP writes', async (permissionMode) => {
    const { engine } = setup({ permissionMode })
    await engine.send({ text: 'Review this' })
    expect(mock.runs[0].options.sandboxMode).toBe('read-only')
    const tools = mock.clients.at(-1).options.config.mcp_servers.novel.enabled_tools
    expect(tools).toContain('scene_read')
    for (const writer of ['scene_write', 'scene_create', 'bible_upsert', 'outline_update', 'timeline_add', 'report_write', 'snapshot_create', 'project_update_config']) expect(tools).not.toContain(writer)
    expect(mock.snapshot).not.toHaveBeenCalled()
    await engine.setPermissionMode('acceptEdits')
    await engine.send({ text: 'Apply this' })
    expect(mock.runs[1].options.sandboxMode).toBe('workspace-write')
    expect(mock.clients.at(-1).options.config.mcp_servers.novel.enabled_tools).toBeUndefined()
    expect(mock.snapshot).toHaveBeenCalledOnce()
  })

  it('ends a fatal stream even when no completion event is sent', async () => {
    mock.fatal = true
    const { engine, events } = setup()
    await engine.send({ text: 'First' })
    expect(engine.busy).toBe(false)
    expect(events.filter((e) => e.type === 'done')).toEqual([{ type: 'done', isError: true }])
  })

  it('honors interruption while reading model metadata', async () => {
    let release!: (catalog: CodexCatalog) => void
    mock.catalog.mockReturnValue(new Promise<CodexCatalog>((r) => { release = r }))
    const { engine, events } = setup()
    const running = engine.send({ text: 'First' })
    await engine.interrupt()
    release(catalog)
    await running
    expect(mock.runs).toHaveLength(0)
    expect(engine.busy).toBe(false)
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1)
  })
})

describe('model effort compatibility', () => {
  it('uses configured effort when supported and model defaults otherwise', () => {
    const configured = { ...catalog, configuredEffort: 'high' }
    expect(codexAutoEffort(configured, 'default')).toBe('high')
    expect(codexAutoEffort(configured, 'quick-model')).toBe('low')
    expect(compatibleCodexEffort(catalog, 'quick-model', 'high')).toBe('')
    expect(compatibleCodexEffort(catalog, 'writing-model', 'high')).toBe('high')
    expect(compatibleCodexEffort(catalog, 'custom-model', 'high')).toBe('high')
  })
})
