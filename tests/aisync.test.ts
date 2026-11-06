// Two simulated devices, each with its own Claude Code and Codex folders, sharing one book through
// "cloud storage" (copying the book folder between their different paths).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scaffoldProject } from '@shared/project'
import { claudeProjectKey, syncAi, syncStatus, type SyncEnv } from '../src/main/services/aisync'

let tmp: string
const device = (name: string): SyncEnv => {
  const d = path.join(tmp, name)
  return { claudeHome: path.join(d, '.claude'), codexHome: path.join(d, '.codex'), stateFile: path.join(d, 'state.json'), deviceId: `${name}-id`, deviceName: name }
}
const w = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
const r = (file: string) => fs.readFileSync(file, 'utf8')
/** Cloud storage: make the other device's copy of the book match this one. */
const cloud = (from: string, to: string) => {
  fs.rmSync(to, { recursive: true, force: true })
  fs.cpSync(from, to, { recursive: true })
}
const esc = (p: string) => JSON.stringify(p).slice(1, -1)

let rootA: string
let rootB: string
let A: SyncEnv
let B: SyncEnv
const claudeDir = (env: SyncEnv, root: string) => path.join(env.claudeHome, 'projects', claudeProjectKey(root))
const TID = '01a1aeb9-e820-7710-8cf5-6726a0cb8e34'
const SID = '4afa0fb6-35fd-4766-9fc7-8a0f75fb45c5'

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-aisync-'))
  rootA = path.join(tmp, 'DesktopCloud', 'My Book')
  rootB = path.join(tmp, 'Laptop Cloud Drive', 'Books', 'My Book')
  A = device('DESKTOP')
  B = device('LAPTOP')
  scaffoldProject(rootA, { title: 'My Book' })
  // Desktop: a Claude chat (with the book's path inside it), Claude memory, and a Codex chat.
  w(path.join(claudeDir(A, rootA), `${SID}.jsonl`), `{"cwd":"${esc(rootA)}","text":"read ${esc(path.join(rootA, 'manuscript', 'x.md'))}"}\n`)
  w(path.join(claudeDir(A, rootA), SID, 'subagents', 'agent-1.jsonl'), '{"sub":true}\n')
  w(path.join(claudeDir(A, rootA), 'memory', 'MEMORY.md'), '- [Voice](voice.md)\n- [Old](old.md)\n')
  w(path.join(claudeDir(A, rootA), 'memory', 'voice.md'), 'Author wants close third, past tense.\n')
  w(path.join(claudeDir(A, rootA), 'memory', 'old.md'), 'An outdated note.\n')
  w(path.join(A.codexHome, 'sessions', '2026', '11', '05', `rollout-2026-11-05T19-39-41-${TID}.jsonl`), '{"codex":1}\n')
  w(path.join(rootA, '.novel', 'sessions', 's1.json'), JSON.stringify({ id: 's1', engineSessions: { claude: SID, codex: TID }, items: [] }))
  // Something unrelated in the desktop's Codex folder must not be copied.
  w(path.join(A.codexHome, 'sessions', '2026', '11', '05', 'rollout-other-ffffffff.jsonl'), '{"other":1}\n')
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('AI memory and chats across devices', () => {
  it('moves chats and memory to another device, rewriting the book path', () => {
    const saved = syncAi(rootA, A, 'both')
    expect(saved.saved.chats).toBe(2) // one Claude chat, one Codex chat
    expect(saved.saved.memory).toBe(3)
    expect(fs.existsSync(path.join(rootA, '.novel', 'ai', 'chats', 'codex', '2026', '11', '05', 'rollout-other-ffffffff.jsonl'))).toBe(false)

    cloud(rootA, rootB)
    const loaded = syncAi(rootB, B, 'both')
    expect(loaded.loaded.chats).toBe(2)
    expect(loaded.loaded.memory).toBe(3)
    expect(loaded.fromDevices).toEqual(['DESKTOP'])

    const chat = r(path.join(claudeDir(B, rootB), `${SID}.jsonl`))
    expect(chat).toContain(esc(rootB))
    expect(chat).toContain(esc(path.join(rootB, 'manuscript', 'x.md')))
    expect(chat).not.toContain(esc(rootA))
    expect(fs.existsSync(path.join(claudeDir(B, rootB), SID, 'subagents', 'agent-1.jsonl'))).toBe(true)
    expect(r(path.join(claudeDir(B, rootB), 'memory', 'voice.md'))).toContain('close third')
    expect(fs.existsSync(path.join(B.codexHome, 'sessions', '2026', '11', '05', `rollout-2026-11-05T19-39-41-${TID}.jsonl`))).toBe(true)

    const st = syncStatus(rootB, B)
    expect(st.devices.map((d) => d.name).sort()).toEqual(['DESKTOP', 'LAPTOP'])
    expect(st.lastLoadFrom).toEqual(['DESKTOP'])
  })

  it('brings work done on the laptop back to the desktop, including edits and deletions', () => {
    syncAi(rootA, A, 'both')
    cloud(rootA, rootB)
    syncAi(rootB, B, 'both')

    // On the laptop: the chat continues, a note is updated, one is deleted, one is added.
    fs.appendFileSync(path.join(claudeDir(B, rootB), `${SID}.jsonl`), `{"cwd":"${esc(rootB)}","text":"more from the laptop"}\n`)
    w(path.join(claudeDir(B, rootB), 'memory', 'voice.md'), 'Author wants close third, PRESENT tense now.\n')
    fs.rmSync(path.join(claudeDir(B, rootB), 'memory', 'old.md'))
    w(path.join(claudeDir(B, rootB), 'memory', 'new.md'), 'Learned on the laptop.\n')
    syncAi(rootB, B, 'both')

    cloud(rootB, rootA)
    const back = syncAi(rootA, A, 'both')
    expect(back.fromDevices).toEqual(['LAPTOP'])
    const chat = r(path.join(claudeDir(A, rootA), `${SID}.jsonl`))
    expect(chat).toContain('more from the laptop')
    expect(chat).not.toContain(esc(rootB)) // rewritten back to the desktop's path
    expect(r(path.join(claudeDir(A, rootA), 'memory', 'voice.md'))).toContain('PRESENT tense')
    expect(fs.existsSync(path.join(claudeDir(A, rootA), 'memory', 'old.md'))).toBe(false) // deletion followed
    expect(r(path.join(claudeDir(A, rootA), 'memory', 'new.md'))).toContain('laptop')
    // A second sync changes nothing and doesn't resurrect the deleted note.
    const again = syncAi(rootA, A, 'both')
    expect(again.loaded).toEqual({ chats: 0, memory: 0, removed: 0 })
    expect(fs.existsSync(path.join(rootA, '.novel', 'ai', 'memory', 'old.md'))).toBe(false)
  })

  it('save only pushes, load only pulls', () => {
    const s = syncAi(rootA, A, 'save')
    expect(s.saved.chats).toBe(2)
    cloud(rootA, rootB)
    w(path.join(claudeDir(B, rootB), 'memory', 'laptop-only.md'), 'x\n')
    const l = syncAi(rootB, B, 'load')
    expect(l.loaded.memory).toBe(3)
    expect(fs.existsSync(path.join(rootB, '.novel', 'ai', 'memory', 'laptop-only.md'))).toBe(false) // not pushed by a load
    syncAi(rootB, B, 'save')
    expect(fs.existsSync(path.join(rootB, '.novel', 'ai', 'memory', 'laptop-only.md'))).toBe(true)
  })

  it('when both devices changed the same note, the newer change wins', () => {
    syncAi(rootA, A, 'both')
    cloud(rootA, rootB)
    syncAi(rootB, B, 'both')
    const noteA = path.join(claudeDir(A, rootA), 'memory', 'voice.md')
    const noteB = path.join(claudeDir(B, rootB), 'memory', 'voice.md')
    w(noteA, 'desktop edit\n')
    fs.utimesSync(noteA, new Date(), new Date(Date.now() - 60_000))
    w(noteB, 'laptop edit (newer)\n')
    syncAi(rootB, B, 'both')
    cloud(rootB, rootA)
    syncAi(rootA, A, 'both')
    expect(r(noteA)).toBe('laptop edit (newer)\n')
  })

  it('gives Codex the shared memory and tells Claude not to edit the synced folder', () => {
    const agents = r(path.join(rootA, 'AGENTS.md'))
    const claude = r(path.join(rootA, 'CLAUDE.md'))
    expect(agents).toContain('.novel/ai/memory/MEMORY.md')
    expect(claude).toContain("Don't edit `.novel/ai/`")
    expect(claude).not.toContain('save it as one short note')
  })
})
