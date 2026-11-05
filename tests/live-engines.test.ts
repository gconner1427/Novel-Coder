// Live end-to-end test against the real engines using your Claude / ChatGPT logins.
// Opt-in (uses a little of your plan's quota):  set LIVE=1 && npx vitest run tests/live-engines.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { scaffoldProject, readScene } from '@shared/project'
import type { EngineEvent, EngineId } from '@shared/types'

const LIVE = process.env.LIVE === '1'
process.env.NOVEL_MCP_SCRIPT = path.resolve('out/main/mcp.js')

async function runTurn(engineId: EngineId, prompt: string, mode: 'auto' | 'acceptEdits' = 'acceptEdits') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `novel-live-${engineId}-`))
  scaffoldProject(root, { title: 'The Lantern Orchard' })
  const events: EngineEvent[] = []
  let resolveDone!: () => void
  const done = new Promise<void>((r) => (resolveDone = r))
  const emit = (e: EngineEvent) => {
    events.push(e)
    if (e.type === 'permission') engine.respondPermission({ requestId: e.requestId, decision: 'allow' })
    if (e.type === 'done') resolveDone()
  }
  const { ClaudeEngine } = await import('../src/main/engines/claudeEngine')
  const { CodexEngine } = await import('../src/main/engines/codexEngine')
  const opts = { root, settings: { engine: engineId, model: 'default', permissionMode: mode }, emit }
  const engine = engineId === 'claude' ? new ClaudeEngine(opts) : new CodexEngine(opts)
  await engine.send({ text: prompt })
  await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 240_000))])
  engine.close()
  if (process.env.DEBUG_EVENTS) console.log(JSON.stringify(events.filter((e) => e.type !== 'text-delta' && e.type !== 'thinking'), null, 1).slice(0, 8000))
  return { root, events }
}

const PROMPT =
  'Call the novel MCP tool project_overview, then use the novel scene_write tool to write exactly this sentence into the first scene (mode replace): "The orchard lanterns woke at dusk." Then reply with only the book title.'

describe.skipIf(!LIVE)('live engines', () => {
  for (const id of ['claude', 'codex'] as const) {
    it(`${id}: uses novel MCP tools via subscription login`, async () => {
      const { root, events } = await runTurn(id, PROMPT)
      const errors = events.filter((e) => e.type === 'error')
      expect(errors, JSON.stringify(errors)).toHaveLength(0)
      expect(events.some((e) => e.type === 'session')).toBe(true)
      const tools = events.filter((e) => e.type === 'tool-start').map((e) => (e as { name: string }).name)
      expect(tools.some((t) => t.includes('project_overview'))).toBe(true)
      const starts = events.filter((e) => e.type === 'tool-start') as { toolId: string; name: string }[]
      const ends = events.filter((e) => e.type === 'tool-end') as { toolId: string; isError?: boolean }[]
      const writeCall = starts.find((s) => s.name === 'mcp__novel__scene_write')
      expect(writeCall, 'scene_write was called').toBeTruthy()
      expect(ends.find((e) => e.toolId === writeCall!.toolId)?.isError, 'scene_write succeeded').toBeFalsy()
      const text = events
        .filter((e) => e.type === 'text-delta' || e.type === 'text')
        .map((e) => (e as { text: string }).text)
        .join('')
      expect(text).toMatch(/Lantern Orchard/i)
      expect(readScene(root, 'manuscript/01-chapter-one/01-opening.md').body).toContain('orchard lanterns woke at dusk')
    }, 300_000)
  }
})
