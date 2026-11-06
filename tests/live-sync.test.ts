// Live: a Claude chat started in a book at one path resumes, with its memory of the conversation, after the
// book's AI data is saved, the book is copied to a different path (another device's cloud folder) and loaded.
//   set LIVE=1 && npm run build && npx vitest run tests/live-sync.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { scaffoldProject } from '@shared/project'
import type { EngineEvent } from '@shared/types'
import { syncAi, type SyncEnv } from '../src/main/services/aisync'

const LIVE = process.env.LIVE === '1'
process.env.NOVEL_MCP_SCRIPT = path.resolve('out/main/mcp.js')

/** Real Claude home; separate per-"device" sync state so each side behaves like its own machine. */
const env = (name: string, tmp: string): SyncEnv => ({
  claudeHome: path.join(os.homedir(), '.claude'),
  codexHome: path.join(os.homedir(), '.codex'),
  stateFile: path.join(tmp, `${name}-state.json`),
  deviceId: `${name}-id`,
  deviceName: name
})

async function ask(root: string, text: string, resumeSessionId?: string) {
  const { ClaudeEngine } = await import('../src/main/engines/claudeEngine')
  const events: EngineEvent[] = []
  let done!: () => void
  const finished = new Promise<void>((r) => (done = r))
  const engine = new ClaudeEngine({
    root,
    resumeSessionId,
    settings: { engine: 'claude', model: 'default', permissionMode: 'acceptEdits' },
    emit: (e) => {
      events.push(e)
      if (e.type === 'permission') engine.respondPermission({ requestId: e.requestId, decision: 'allow' })
      if (e.type === 'done') done()
    }
  })
  await engine.send({ text })
  await Promise.race([finished, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 180_000))])
  engine.close()
  await new Promise((r) => setTimeout(r, 1500)) // let the transcript finish writing
  const session = events.find((e) => e.type === 'session') as { sessionId: string } | undefined
  const reply = events
    .filter((e) => e.type === 'text-delta')
    .map((e) => (e as { text: string }).text)
    .join('')
  const errors = events.filter((e) => e.type === 'error').map((e) => (e as { message: string }).message)
  return { sessionId: session?.sessionId, reply, errors }
}

describe.skipIf(!LIVE)('Claude chat follows the book to another device', () => {
  it('resumes with the earlier conversation after save → copy to a new path → load', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-sync-live-'))
    const rootA = path.join(tmp, 'Desktop', 'Code Word Book')
    const rootB = path.join(tmp, 'Laptop Cloud', 'Books', 'Code Word Book')
    scaffoldProject(rootA, { title: 'Code Word Book' })

    const first = await ask(rootA, 'Remember this code word for later: MARIGOLD-7. Just reply "Noted." and nothing else.')
    expect(first.errors).toEqual([])
    expect(first.sessionId).toBeTruthy()

    const saved = syncAi(rootA, env('DESKTOP', tmp), 'save')
    expect(saved.saved.chats).toBeGreaterThan(0)
    fs.cpSync(rootA, rootB, { recursive: true }) // cloud storage, different folder on the laptop
    const loaded = syncAi(rootB, env('LAPTOP', tmp), 'load')
    expect(loaded.loaded.chats).toBeGreaterThan(0)

    const second = await ask(rootB, 'What was the code word I gave you earlier? Reply with just the code word.', first.sessionId)
    expect(second.errors).toEqual([])
    expect(second.reply).toMatch(/MARIGOLD-7/i)
  }, 420_000)
})
