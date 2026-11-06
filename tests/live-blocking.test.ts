// Live check of the Blocking run on a scene with planted staging errors (uses a little plan quota):
//   set LIVE=1 && npm run build && npx vitest run tests/live-blocking.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { scaffoldProject, upsertBibleEntry, writeScene, readScene } from '@shared/project'
import type { EngineEvent, EngineId } from '@shared/types'

const LIVE = process.env.LIVE === '1'
process.env.NOVEL_MCP_SCRIPT = path.resolve('out/main/mcp.js')

// Close third person on Mara. Planted problems, in order:
//  A. infinite hands: mug in one hand, suitcase in the other, then she opens the door with no hand free
//  B. POV-hear: a whisper from the far end of a long hall heard word for word
//  C. POV-see: her back is to Tom, yet she sees him smile
//  D. teleport: she is in the doorway, then touches Tom's cheek, though he is across the room
//  E. POV-self: she describes her own eyes from outside
const SCENE = `Mara stood in the hallway with a mug of tea in her left hand and the handle of her suitcase in her right. She reached out and opened the front door.

At the far end of the long hall, forty feet away, Tom leaned toward his sister and whispered, "She's never coming back." Mara heard every word.

She turned her back on them and stared out at the rain. Behind her, Tom smiled a slow, cruel smile.

She stood in the doorway. Then she brushed Tom's cheek with her fingertips, and he flinched.

Her green eyes sparkled with defiance as she stepped outside.`

async function run(engineId: EngineId) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `novel-blocking-${engineId}-`))
  scaffoldProject(root, { title: 'The Long Hall', pov: 'Third person limited (Mara)' })
  upsertBibleEntry(root, 'characters', 'Mara', { role: 'protagonist' })
  upsertBibleEntry(root, 'characters', 'Tom', { role: "Mara's brother-in-law" })
  const scene = 'manuscript/01-chapter-one/01-opening.md'
  writeScene(root, scene, { title: 'Leaving', pov: 'Mara', location: 'The house on Wren Street, front hall', characters: ['Mara', 'Tom'] }, SCENE)

  const { BUILTIN_COMMANDS, expandPrompt } = await import('../src/main/engines/prompts')
  const prompt = expandPrompt(BUILTIN_COMMANDS.blocking.prompt!, scene)
  const events: EngineEvent[] = []
  let done!: () => void
  const finished = new Promise<void>((r) => (done = r))
  const emit = (e: EngineEvent) => {
    events.push(e)
    if (e.type === 'permission') engine.respondPermission({ requestId: e.requestId, decision: 'allow' })
    if (e.type === 'done') done()
  }
  const { ClaudeEngine } = await import('../src/main/engines/claudeEngine')
  const { CodexEngine } = await import('../src/main/engines/codexEngine')
  const opts = { root, settings: { engine: engineId, model: 'default', permissionMode: 'acceptEdits' as const }, emit }
  const engine = engineId === 'claude' ? new ClaudeEngine(opts) : new CodexEngine(opts)
  await engine.send({ text: prompt })
  await Promise.race([finished, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 420_000))])
  engine.close()

  const reports = fs.readdirSync(path.join(root, '.novel', 'reports')).filter((f) => f.endsWith('.md'))
  const report = reports.map((f) => fs.readFileSync(path.join(root, '.novel', 'reports', f), 'utf8')).join('\n')
  const reply = events
    .filter((e) => e.type === 'text' || e.type === 'text-delta')
    .map((e) => (e as { text: string }).text)
    .join('')
  if (process.env.DEBUG_EVENTS) console.log(`--- ${engineId} report ---\n${report}\n--- reply ---\n${reply}`)
  return { root, scene, report, reply, reports }
}

describe.skipIf(!LIVE)('Blocking run', () => {
  for (const id of ['claude', 'codex'] as const) {
    it(`${id}: finds the planted staging and POV problems without editing the scene`, async () => {
      const { root, scene, report, reports } = await run(id)
      expect(reports.some((f) => /blocking/i.test(f)), 'saved a blocking report').toBe(true)
      const r = report.toLowerCase()
      expect(r, 'A: hands').toMatch(/hand/)
      expect(r, 'B: whisper heard').toMatch(/whisper/)
      expect(r, 'C: smile seen behind her').toMatch(/smile|back/)
      expect(r, 'D: across the room').toMatch(/cheek|across|distance|reach/)
      expect(r, 'E: own eyes').toMatch(/eyes|sparkl/)
      // Report only: the scene text is untouched.
      expect(readScene(root, scene).body.trim()).toBe(SCENE.trim())
    }, 480_000)
  }
})
