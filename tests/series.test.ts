import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addBookToSeries,
  continuityContext,
  convertToSeries,
  findBibleEntry,
  findSeriesRoot,
  listBible,
  listBooks,
  loadProject,
  resolveInside,
  scaffoldProject,
  scaffoldSeries,
  upsertBibleEntry,
  writeScene
} from '@shared/project'
import { createSnapshot, fileAtSnapshot, restoreSnapshot } from '@shared/snapshots'
import { BrainstormStore, parseIdeas, transcriptMarkdown } from '../src/main/services/brainstorm'

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-series-'))
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('series', () => {
  it('scaffolds a series with a shared bible and first book', () => {
    const s = path.join(tmp, 'Lantern Cycle')
    const book1 = scaffoldSeries(s, { seriesTitle: 'The Lantern Cycle', firstBookTitle: 'Dusk Harvest', plannedBooks: 3, genre: 'Fantasy', pov: 'First person' })
    expect(fs.existsSync(path.join(s, 'series.json'))).toBe(true)
    expect(fs.existsSync(path.join(s, 'series-outline.md'))).toBe(true)
    expect(fs.existsSync(path.join(s, 'bible', 'characters', 'protagonist.md'))).toBe(true)
    expect(fs.readFileSync(path.join(s, 'series-outline.md'), 'utf8')).toContain('## Book 3')
    expect(findSeriesRoot(book1)).toBe(path.resolve(s))
    // Book inherits series POV and has no duplicate protagonist / style guide
    const p = loadProject(book1)
    expect(p.config.pov).toBe('First person')
    expect(p.config.seriesNumber).toBe(1)
    expect(fs.existsSync(path.join(book1, 'bible', 'characters', 'protagonist.md'))).toBe(false)
    expect(p.series?.config.title).toBe('The Lantern Cycle')
    expect(p.series?.files).toContain('../series-outline.md')
    // Agent instructions mention the series
    const agents = fs.readFileSync(path.join(book1, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('This book is part of a series')
    expect(agents).toContain('scope: "series"')
  })

  it('merges series and book bibles, with scope-aware writes and path access', () => {
    const s = path.join(tmp, 'S')
    const book1 = scaffoldSeries(s, { seriesTitle: 'S', firstBookTitle: 'One' })
    upsertBibleEntry(book1, 'characters', 'Wren Hale', { aliases: ['Wren'], eyes: 'grey' }, 'Lead.', 'merge', 'series')
    upsertBibleEntry(book1, 'characters', 'Toll Keeper', { summary: 'Book-one villain' })
    const all = listBible(book1)
    expect(all.find((e) => e.name === 'Wren Hale')?.scope).toBe('series')
    expect(all.find((e) => e.name === 'Wren Hale')?.path).toBe('../bible/characters/wren-hale.md')
    expect(all.find((e) => e.name === 'Toll Keeper')?.scope).toBe('book')
    // Updating without scope updates the entry where it already lives
    upsertBibleEntry(book1, 'characters', 'Wren Hale', { age: 18 })
    expect(findBibleEntry(book1, 'wren')?.fields.age).toBe(18)
    expect(fs.existsSync(path.join(book1, 'bible', 'characters', 'wren-hale.md'))).toBe(false)
    // Book 2 sees the series bible but not book 1's private entries
    const book2 = addBookToSeries(s, 'Two')
    expect(listBooks(s).map((b) => b.title)).toEqual(['One', 'Two'])
    expect(loadProject(book2).config.seriesNumber).toBe(2)
    expect(findBibleEntry(book2, 'Wren')?.name).toBe('Wren Hale')
    expect(findBibleEntry(book2, 'Toll Keeper')).toBeUndefined()
    // ../ paths into the series are allowed, outside it are not
    expect(() => resolveInside(book2, '../series-outline.md')).not.toThrow()
    expect(() => resolveInside(book2, `../${path.basename(book1)}/manuscript`)).not.toThrow()
    expect(() => resolveInside(book2, '../../escape.md')).toThrow()
  })

  it('includes earlier books in continuity context', () => {
    const s = path.join(tmp, 'S')
    const book1 = scaffoldSeries(s, { seriesTitle: 'S', firstBookTitle: 'One' })
    writeScene(book1, 'manuscript/01-chapter-one/01-opening.md', { summary: 'Wren loses the orchard key.' }, 'Text.')
    upsertBibleEntry(book1, 'characters', 'Wren', { eyes: 'grey' }, '', 'merge', 'series')
    const book2 = addBookToSeries(s, 'Two')
    writeScene(book2, 'manuscript/01-chapter-one/01-opening.md', {}, 'Wren returned to the hill.')
    const ctx = continuityContext(book2, 'manuscript/01-chapter-one/01-opening.md')
    expect(ctx).toContain('Earlier book 1: One')
    expect(ctx).toContain('Wren loses the orchard key.')
    expect(ctx).toContain('series bible')
  })

  it('converts a standalone novel into book 1 of a series', () => {
    const book = path.join(tmp, 'Glass')
    scaffoldProject(book, { title: 'The Glass Harbour' })
    writeScene(book, 'manuscript/01-chapter-one/01-opening.md', {}, 'Keep me.')
    const dest = convertToSeries(book, 'Harbour Saga', 4)
    expect(fs.existsSync(book)).toBe(false)
    expect(findSeriesRoot(dest)).toBeTruthy()
    const p = loadProject(dest)
    expect(p.config.seriesNumber).toBe(1)
    expect(p.series?.config.plannedBooks).toBe(4)
    expect(p.totalWords).toBe(2)
  })

  it('snapshots and rewinds the whole series folder', async () => {
    const s = path.join(tmp, 'S')
    const book1 = scaffoldSeries(s, { seriesTitle: 'S', firstBookTitle: 'One' })
    const outline = path.join(s, 'series-outline.md')
    fs.writeFileSync(outline, 'v1')
    const oid = await createSnapshot(book1, 'v1')
    expect(fs.existsSync(path.join(s, '.novel', 'history'))).toBe(true)
    fs.writeFileSync(outline, 'v2')
    expect(await fileAtSnapshot(book1, oid!, '../series-outline.md')).toBe('v1')
    await restoreSnapshot(book1, oid!)
    expect(fs.readFileSync(outline, 'utf8')).toBe('v1')
  })
})

describe('brainstorm', () => {
  it('parses idea fields for a series and a standalone', () => {
    const f = parseIdeas(`# Book idea\n- Working title: **The Lantern Cycle**\n- Format: series of 4 books\n- Genre: Fantasy\n- Point of view: close third, rotating\n- Tense: present\n- Premise: Fruit that holds memories.\n`)
    expect(f).toEqual({ title: 'The Lantern Cycle', genre: 'Fantasy', pov: 'close third, rotating', tense: 'present', premise: 'Fruit that holds memories.', series: true, plannedBooks: 4 })
    const g = parseIdeas('- Working title: \n- Format: standalone novel\n- Genre: TBD\n')
    expect(g.series).toBe(false)
    expect(g.title).toBeUndefined()
    expect(g.genre).toBeUndefined()
    expect(parseIdeas('- Format: a trilogy').plannedBooks).toBe(3)
  })

  it('stores brainstorm workspaces with session, ideas and instructions', () => {
    const store = new BrainstormStore(tmp)
    const { meta, dir } = store.create('codex')
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toContain('ideas.md')
    fs.writeFileSync(path.join(dir, 'ideas.md'), '- Working title: Moth Kings\n')
    store.saveSession(meta.id, {
      id: 's1',
      title: 'Moths',
      created: 1,
      updated: 2,
      engine: 'codex',
      engineSessions: {},
      items: [
        { kind: 'user', id: 'u', text: 'A moth empire?', engine: 'codex', ts: 1 },
        { kind: 'assistant', id: 'a', text: 'Yes!', engine: 'codex', ts: 2 }
      ]
    })
    const list = store.list()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('Moth Kings') // title comes from ideas.md
    const loaded = store.load(meta.id)!
    expect(transcriptMarkdown(loaded.session)).toContain('**Author:** A moth empire?')
    store.delete(meta.id)
    expect(store.list()).toHaveLength(0)
  })
})
