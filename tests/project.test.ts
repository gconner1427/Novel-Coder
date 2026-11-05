import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  compileManuscript,
  continuityContext,
  countWords,
  createChapter,
  createScene,
  entriesMentioned,
  findBibleEntry,
  listChapters,
  loadProject,
  readScene,
  resolveInside,
  scaffoldProject,
  searchBible,
  upsertBibleEntry,
  writeScene
} from '@shared/project'
import { createSnapshot, listSnapshots, restoreSnapshot } from '@shared/snapshots'
import { exportManuscript } from '../src/main/services/exporter'
import { recordWords, streak } from '../src/main/services/store'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-test-'))
  scaffoldProject(root, { title: 'The Glass Harbour', author: 'Ada Writer', genre: 'Fantasy', premise: 'A harbour made of glass.' })
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('project model', () => {
  it('scaffolds a full novel project', () => {
    for (const f of ['novel.json', 'NOVEL.md', 'CLAUDE.md', 'AGENTS.md', 'outline/outline.md', 'outline/beats.md', 'bible/style-guide.md', 'bible/timeline.md', 'bible/characters/protagonist.md'])
      expect(fs.existsSync(path.join(root, f)), f).toBe(true)
    const p = loadProject(root)
    expect(p.config.title).toBe('The Glass Harbour')
    expect(p.chapters).toHaveLength(1)
    expect(p.chapters[0].scenes[0].path).toBe('manuscript/01-chapter-one/01-opening.md')
    expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toContain('The Glass Harbour')
  })

  it('counts words ignoring frontmatter and markup', () => {
    expect(countWords('---\ntitle: X\nstatus: drafted\n---\n\n# Heading\n\nShe *ran* to the [harbour](x).  It’s glass-bright.')).toBe(8)
  })

  it('writes scenes preserving frontmatter and orders chapters', () => {
    const ch2 = createChapter(root, 'The Storm')
    const s = createScene(root, ch2, 'Lightning', { pov: 'Mara' })
    writeScene(root, s, { status: 'drafted', summary: 'Mara sees lightning.' }, 'Mara watched the sky split open.')
    const r = readScene(root, s)
    expect(r.meta.pov).toBe('Mara')
    expect(r.meta.status).toBe('drafted')
    expect(r.body.trim()).toBe('Mara watched the sky split open.')
    const chs = listChapters(root)
    expect(chs.map((c) => c.title)).toEqual(['Chapter One', 'The Storm'])
    expect(chs[1].words).toBe(6)
    expect(compileManuscript(root).chapters[1].text).toContain('sky split')
  })

  it('manages the story bible', () => {
    upsertBibleEntry(root, 'characters', 'Mara Quill', { aliases: ['Mara'], role: 'protagonist', eyes: 'grey' }, 'A glassblower.')
    upsertBibleEntry(root, 'locations', 'Glass Harbour', { summary: 'The city' })
    expect(findBibleEntry(root, 'mara')?.name).toBe('Mara Quill')
    expect(searchBible(root, 'glassblower')[0].name).toBe('Mara Quill')
    upsertBibleEntry(root, 'characters', 'Mara Quill', { age: 31 })
    const e = findBibleEntry(root, 'Mara Quill')!
    expect(e.fields.eyes).toBe('grey')
    expect(e.fields.age).toBe(31)
    expect(e.body).toBe('A glassblower.')
    expect(entriesMentioned(root, 'Mara walked down to the glass harbour').map((x) => x.name).sort()).toEqual(['Glass Harbour', 'Mara Quill'])
  })

  it('builds continuity context for a scene', () => {
    upsertBibleEntry(root, 'characters', 'Mara Quill', { aliases: ['Mara'], eyes: 'grey' })
    const s = 'manuscript/01-chapter-one/01-opening.md'
    writeScene(root, s, {}, 'Mara looked out across the water.')
    const ctx = continuityContext(root, s)
    expect(ctx).toContain('Mara Quill')
    expect(ctx).toContain('eyes: grey')
    expect(ctx).toContain('Style guide')
  })

  it('refuses paths that escape the project', () => {
    expect(() => resolveInside(root, '../outside.md')).toThrow()
  })
})

describe('snapshots', () => {
  it('creates, lists and restores snapshots', async () => {
    const s = 'manuscript/01-chapter-one/01-opening.md'
    writeScene(root, s, {}, 'Version one.')
    const a = await createSnapshot(root, 'v1')
    expect(a).toBeTruthy()
    expect(await createSnapshot(root, 'no change')).toBeNull()
    writeScene(root, s, {}, 'Version two, much longer.')
    fs.writeFileSync(path.join(root, 'notes', 'new.md'), 'new file')
    await createSnapshot(root, 'v2')
    await restoreSnapshot(root, a!)
    expect(readScene(root, s).body.trim()).toBe('Version one.')
    expect(fs.existsSync(path.join(root, 'notes', 'new.md'))).toBe(false)
    const log = await listSnapshots(root)
    expect(log[0].message).toMatch(/Rewound/)
  })
})

describe('stats', () => {
  it('records daily words and streaks', () => {
    const st = recordWords(root, 100)
    expect(st.days).toHaveLength(1)
    const st2 = recordWords(root, 1300)
    expect(st2.days[0].endWords - st2.days[0].startWords).toBe(1200)
    expect(streak(st2, 1000)).toBe(1)
  })
})

describe('export', () => {
  const pdf = async () => Buffer.from('%PDF-fake')
  it.each(['md', 'docx', 'epub'] as const)('exports %s', async (fmt) => {
    writeScene(root, 'manuscript/01-chapter-one/01-opening.md', {}, 'It was a *bright* morning.\n\n#\n\nLater, **everything** broke.')
    const r = await exportManuscript(root, fmt, undefined, pdf)
    expect(fs.existsSync(r.file)).toBe(true)
    expect(fs.statSync(r.file).size).toBeGreaterThan(50)
    expect(r.words).toBe(8)
    if (fmt === 'md') expect(fs.readFileSync(r.file, 'utf8')).toContain('# The Glass Harbour')
    if (fmt !== 'md') expect(fs.readFileSync(r.file).subarray(0, 2).toString()).toBe('PK') // zip container
  })
})
