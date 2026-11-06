import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ignoredByWatcher } from '../src/main/services/watchfilter'
import { recordWords } from '../src/main/services/store'
import { scaffoldProject, syncAgentInstructions } from '@shared/project'

describe('book watcher', () => {
  const book = 'C:\\Users\\me\\Books\\Series\\01-book'
  it("ignores the app's own bookkeeping but not the book or its reports", () => {
    for (const p of ['.novel\\stats.json', '.novel\\history\\objects\\ab', '.novel\\sessions\\x.json', '.novel\\ai\\manifest.json', 'node_modules\\x', '.git\\HEAD', 'exports\\book.docx'])
      expect(ignoredByWatcher(path.win32.join(book, p)), p).toBe(true)
    for (const p of ['manuscript\\01-ch\\01-scene.md', 'bible\\characters\\mara.md', 'NOVEL.md', '.novel', '.novel\\reports\\r.md', '.novel\\commands\\c.md'])
      expect(ignoredByWatcher(path.win32.join(book, p)), p).toBe(false)
    expect(ignoredByWatcher('C:\\Users\\me\\Books\\Series\\bible\\characters\\x.md')).toBe(false)
  })

  it("doesn't rewrite stats or AI instruction files when nothing changed (no reload loop)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-watch-'))
    scaffoldProject(root, { title: 'Loop' })
    recordWords(root, 100)
    const stats = path.join(root, '.novel', 'stats.json')
    const claude = path.join(root, 'CLAUDE.md')
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(stats, old, old)
    fs.utimesSync(claude, old, old)
    const before = [fs.statSync(stats).mtimeMs, fs.statSync(claude).mtimeMs]
    recordWords(root, 100)
    syncAgentInstructions(root)
    expect([fs.statSync(stats).mtimeMs, fs.statSync(claude).mtimeMs]).toEqual(before)
    recordWords(root, 150) // a real change is still recorded
    expect(fs.statSync(stats).mtimeMs).toBeGreaterThan(before[0])
    fs.rmSync(root, { recursive: true, force: true })
  })
})
