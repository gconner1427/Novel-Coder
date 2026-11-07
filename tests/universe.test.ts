// Shared universes (several series and standalones with a universe bible), the three bible layers,
// custom bible categories and crossover events.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  addBookToSeries,
  addSeriesToUniverse,
  addStandaloneToUniverse,
  convertToUniverse,
  moveIntoUniverse,
  parseTimeline,
  readScene,
  saveReadingOrder,
  scaffoldSeries,
  universeOverview,
  universeReadingOrder,
  containerRoot,
  continuityContext,
  deleteBibleCategory,
  findAppearances,
  findBibleEntry,
  findSeriesRoot,
  findUniverseRoot,
  listBible,
  listBibleCategories,
  loadConfig,
  loadProject,
  resolveInside,
  saveBibleCategory,
  saveConfig,
  scaffoldProject,
  scaffoldUniverse,
  shelfBook,
  upsertBibleEntry,
  writeScene,
} from '@shared/project'
import { createSnapshot, snapshotBase } from '@shared/snapshots'
import { buildServer } from '../src/mcp/novel-server'

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-universe-'))
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

const OPENING = 'manuscript/01-chapter-one/01-opening.md'

/** A universe with two series (one book each, a second book in the first) and a standalone novella. */
function makeUniverse() {
  const u = scaffoldUniverse(path.join(tmp, 'Vanguard'), { title: 'The Vanguard Universe', genre: 'Superhero', pov: 'Close third' })
  const iron1 = addSeriesToUniverse(u, { seriesTitle: 'Iron Saint', firstBookTitle: 'Origin of Iron' })
  const iron2 = addBookToSeries(findSeriesRoot(iron1)!, 'Iron Falls')
  const night1 = addSeriesToUniverse(u, { seriesTitle: 'Night Court', firstBookTitle: 'Gavel' })
  const novella = addStandaloneToUniverse(u, { title: 'The Long Night', format: 'novella' })
  return { u, iron1, iron2, night1, novella }
}

describe('universe', () => {
  it('scaffolds a universe holding series and standalones', () => {
    const { u, iron1, iron2, night1, novella } = makeUniverse()
    for (const f of ['universe.json', 'UNIVERSE.md', 'universe-outline.md', 'bible/timeline.md', 'bible/style-guide.md']) expect(fs.existsSync(path.join(u, f))).toBe(true)
    expect(findUniverseRoot(iron1)).toBe(path.resolve(u))
    expect(findUniverseRoot(novella)).toBe(path.resolve(u))
    expect(findSeriesRoot(novella)).toBeNull()
    expect(containerRoot(iron2)).toBe(path.resolve(u))
    // Series and standalones inherit the universe defaults
    expect(loadConfig(night1).pov).toBe('Close third')
    expect(loadConfig(novella).genre).toBe('Superhero')
    // Format sets a fitting target
    expect(loadConfig(novella).format).toBe('novella')
    expect(loadConfig(novella).targetWords).toBe(30000)

    const p = loadProject(iron2)
    expect(p.universe?.config.title).toBe('The Vanguard Universe')
    expect(p.universe?.prefix).toBe('../..')
    expect(p.universe?.series.map((s) => s.title)).toEqual(['Iron Saint', 'Night Court'])
    expect(p.universe?.series[0].current).toBe(true)
    expect(p.universe?.series[0].books.map((b) => b.title)).toEqual(['Origin of Iron', 'Iron Falls'])
    expect(p.universe?.standalones.map((b) => b.title)).toEqual(['The Long Night'])
    expect(p.universe?.files).toContain('../../universe-outline.md')
    expect(loadProject(novella).universe?.prefix).toBe('..')
    expect(shelfBook(novella)).toMatchObject({ universeTitle: 'The Vanguard Universe', format: 'novella' })
    // A plain series or standalone has no universe
    scaffoldProject(path.join(tmp, 'Solo'), { title: 'Solo' })
    expect(loadProject(path.join(tmp, 'Solo')).universe).toBeUndefined()
  })

  it('tells the AI about the universe in every book', () => {
    const { iron2, novella } = makeUniverse()
    const agents = fs.readFileSync(path.join(iron2, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('This book is part of a shared universe')
    expect(agents).toContain('book 2 of the series **Iron Saint**')
    expect(agents).toContain('`../../universe-outline.md`')
    expect(agents).toContain('Series **Night Court** (`../../Night Court/`)')
    expect(agents).toContain('The Long Night (novella)')
    expect(agents).toContain('scope: "universe"')
    expect(agents).toContain('## Universe instructions')
    // The series section is still there for series books
    expect(agents).toContain('This book is part of a series')
    const solo = fs.readFileSync(path.join(novella, 'CLAUDE.md'), 'utf8')
    expect(solo).toContain('a standalone novella (not part of any series)')
    expect(solo).toContain('`../universe-outline.md`')
    expect(solo).not.toContain('This book is part of a series')
  })

  it('layers book, series and universe bibles with the closest one winning', () => {
    const { u, iron1, iron2, night1, novella } = makeUniverse()
    upsertBibleEntry(iron1, 'characters', 'Mara Voss', { aliases: ['Iron Saint'], powers: 'steel skin' }, 'Lead of Iron Saint.', 'merge', 'universe')
    upsertBibleEntry(iron1, 'characters', 'Detective Hale', { summary: 'Iron Saint regular' }, '', 'merge', 'series')
    // Every book in the universe sees universe entries, with paths relative to itself
    expect(findBibleEntry(night1, 'Iron Saint')?.path).toBe('../../bible/characters/mara-voss.md')
    expect(findBibleEntry(novella, 'Mara Voss')?.path).toBe('../bible/characters/mara-voss.md')
    expect(findBibleEntry(novella, 'Mara Voss')?.scope).toBe('universe')
    // Series entries stay inside their series
    expect(findBibleEntry(iron2, 'Detective Hale')?.scope).toBe('series')
    expect(findBibleEntry(night1, 'Detective Hale')).toBeUndefined()
    // Updating without a scope updates the entry where it lives
    upsertBibleEntry(night1, 'characters', 'Mara Voss', { age: 34 })
    expect(fs.existsSync(path.join(u, 'bible', 'characters', 'mara-voss.md'))).toBe(true)
    expect(findBibleEntry(iron2, 'Mara Voss')?.fields.age).toBe(34)
    // A series can keep its own version of a universe character; it wins inside that series only
    upsertBibleEntry(night1, 'characters', 'Mara Voss', { summary: 'As Night Court sees her' }, '', 'merge', 'series')
    expect(findBibleEntry(night1, 'Mara Voss')?.scope).toBe('series')
    expect(findBibleEntry(iron2, 'Mara Voss')?.scope).toBe('universe')
    expect(listBible(night1).filter((e) => e.name === 'Mara Voss').map((e) => e.scope)).toEqual(['series', 'universe'])
    expect(listBible(night1, undefined, ['universe']).map((e) => e.name)).toEqual(['Mara Voss'])
    // A standalone has no series bible
    expect(() => upsertBibleEntry(novella, 'characters', 'X', {}, '', 'merge', 'series')).toThrow(/not part of a series/)
  })

  it('lets books reach the whole universe, but nothing outside it', () => {
    const { iron1, night1, novella } = makeUniverse()
    expect(() => resolveInside(iron1, `../../Night Court/${path.basename(night1)}/${OPENING}`)).not.toThrow()
    expect(() => resolveInside(novella, '../Iron Saint/series-outline.md')).not.toThrow()
    expect(() => resolveInside(iron1, '../../../escape.md')).toThrow()
    expect(() => resolveInside(novella, '../../escape.md')).toThrow()
  })

  it('snapshots the whole universe', async () => {
    const { u, iron1, novella } = makeUniverse()
    expect(snapshotBase(iron1)).toBe(path.resolve(u))
    expect(snapshotBase(novella)).toBe(path.resolve(u))
    expect(await createSnapshot(novella, 'start')).toBeTruthy()
    expect(fs.existsSync(path.join(u, '.novel', 'history'))).toBe(true)
  })

  it('finds where a character appears across every series and standalone', () => {
    const { iron1, night1, novella } = makeUniverse()
    upsertBibleEntry(iron1, 'characters', 'Mara Voss', { aliases: ['Iron Saint'] }, '', 'merge', 'universe')
    writeScene(iron1, OPENING, { characters: ['Mara Voss'], summary: 'Mara gets her powers.' }, 'Steel bloomed under her skin.')
    writeScene(night1, OPENING, { summary: 'The court convenes.' }, 'Everyone had heard of the Iron Saint.')
    writeScene(novella, OPENING, {}, 'Nobody here knows her.')
    const found = findAppearances(night1, 'Mara Voss')
    expect(found.map((f) => [f.book, f.how])).toEqual([
      ['Origin of Iron', 'listed'],
      ['Gavel', 'mentioned']
    ])
    expect(found[0].path).toBe(`../../Iron Saint/${path.basename(iron1)}/${OPENING}`)
    expect(found[0].seriesTitle).toBe('Iron Saint')
  })

  it('links crossover parts across series and feeds earlier parts to the AI', () => {
    const { u, iron2, night1, novella } = makeUniverse()
    saveConfig(iron2, { ...loadConfig(iron2), crossover: { event: 'Blackout', part: 1 } })
    saveConfig(night1, { ...loadConfig(night1), crossover: { event: 'blackout', part: 2 } })
    writeScene(iron2, OPENING, { summary: 'The city goes dark as Mara falls.' }, 'Dark.')
    writeScene(night1, OPENING, {}, 'The lights were still out.')
    const p = loadProject(night1)
    expect(p.universe?.crossovers).toHaveLength(1)
    expect(p.universe?.crossovers[0].parts.map((x) => [x.part, x.title, x.seriesTitle, x.current])).toEqual([
      [1, 'Iron Falls', 'Iron Saint', false],
      [2, 'Gavel', 'Night Court', true]
    ])
    const ctx = continuityContext(night1, OPENING)
    expect(ctx).toContain('Crossover: Blackout (this book is part 2 of 2)')
    expect(ctx).toContain('Earlier crossover part 1: Iron Falls')
    expect(ctx).toContain('The city goes dark as Mara falls.')
    expect(ctx).toContain('Universe timeline')
    expect(continuityContext(iron2, OPENING)).toContain('Later crossover part 2: Gavel')
    // Instructions in every part list the whole event once every book is refreshed
    for (const b of [iron2, night1]) saveConfig(b, loadConfig(b))
    expect(fs.readFileSync(path.join(iron2, 'AGENTS.md'), 'utf8')).toContain('part 1 of the crossover event "Blackout"')
    expect(fs.readFileSync(path.join(night1, 'AGENTS.md'), 'utf8')).toContain(`Part 1: Iron Falls (Iron Saint), \`../../Iron Saint/${path.basename(iron2)}/\``)
    expect(continuityContext(novella, OPENING)).not.toContain('Crossover')
    expect(u).toBeTruthy()
  })
})

describe('bringing existing work into a universe', () => {
  it('turns a series, with every book, into a new universe', () => {
    const s = path.join(tmp, 'Iron Saint')
    const book1 = scaffoldSeries(s, { seriesTitle: 'Iron Saint', firstBookTitle: 'Origin', genre: 'Superhero' })
    const book2 = addBookToSeries(s, 'Falls')
    saveBibleCategory(book1, 'Powers', 'series', { fields: ['source'] })
    writeScene(book2, OPENING, {}, 'Keep me.')
    const moved = convertToUniverse(book2, 'Vanguard', 'Heroes everywhere.')
    const u = path.join(tmp, 'Vanguard')
    expect(fs.existsSync(s)).toBe(false)
    expect(moved).toBe(path.join(u, 'Iron Saint', path.basename(book2)))
    expect(findUniverseRoot(moved)).toBe(path.resolve(u))
    expect(readScene(moved, OPENING).body.trim()).toBe('Keep me.')
    expect(loadProject(moved).universe?.series[0].books.map((b) => b.title)).toEqual(['Origin', 'Falls'])
    expect(loadProject(moved).universe?.config).toMatchObject({ title: 'Vanguard', genre: 'Superhero', description: 'Heroes everywhere.' })
    // The universe bible starts with the categories the series used
    expect(listBibleCategories(moved).find((c) => c.slug === 'powers')).toMatchObject({ scopes: ['series', 'universe'], fields: ['source'] })
    // Every moved book's instructions now describe the universe
    expect(fs.readFileSync(path.join(u, 'Iron Saint', path.basename(book1), 'AGENTS.md'), 'utf8')).toContain('This book is part of a shared universe')
    expect(() => convertToUniverse(moved, 'Again')).toThrow(/already part of a universe/)
  })

  it('turns a standalone into a universe, and moves others into it', () => {
    const solo = path.join(tmp, 'Long Night')
    scaffoldProject(solo, { title: 'The Long Night' })
    const moved = convertToUniverse(solo, 'Vanguard')
    const u = findUniverseRoot(moved)!
    expect(path.dirname(moved)).toBe(path.resolve(u))
    expect(loadProject(moved).universe?.standalones.map((b) => b.title)).toEqual(['The Long Night'])
    // An existing series joins it, keeping its folder name
    const s = path.join(tmp, 'Night Court')
    const gavel = scaffoldSeries(s, { seriesTitle: 'Night Court', firstBookTitle: 'Gavel' })
    const gavelMoved = moveIntoUniverse(gavel, u)
    expect(gavelMoved).toBe(path.join(u, 'Night Court', path.basename(gavel)))
    // A second standalone with a clashing folder name gets a free one
    const other = path.join(tmp, 'elsewhere', 'Long Night')
    scaffoldProject(other, { title: 'Another Night' })
    expect(path.basename(moveIntoUniverse(other, u))).toBe('Long Night (2)')
    expect(universeReadingOrder(u).map((b) => b.title)).toEqual(['Gavel', 'The Long Night', 'Another Night'])
    expect(() => moveIntoUniverse(gavelMoved, u)).toThrow(/already part of a universe/)
    expect(() => moveIntoUniverse(path.join(tmp, 'nowhere'), tmp)).toThrow(/not a universe/)
  })
})

describe('reading order, chronicle and appearances', () => {
  it('keeps the author\'s reading order and tells the AI', () => {
    const { u, iron1, iron2, night1, novella } = makeUniverse()
    const key = (r: string) => path.relative(u, r).split(path.sep).join('/')
    expect(universeReadingOrder(u).map((b) => b.title)).toEqual(['Origin of Iron', 'Iron Falls', 'Gavel', 'The Long Night'])
    saveReadingOrder(u, [key(iron1), key(novella), key(night1)])
    // Books left out of the saved order follow it
    expect(universeReadingOrder(u).map((b) => b.title)).toEqual(['Origin of Iron', 'The Long Night', 'Gavel', 'Iron Falls'])
    expect(fs.readFileSync(path.join(iron2, 'AGENTS.md'), 'utf8')).toContain('Reading order (as the author wants readers to read them): 1. Origin of Iron (Iron Saint 1); 2. The Long Night; 3. Gavel (Night Court 1); 4. Iron Falls (Iron Saint 2) (this book)')
  })

  it('parses timelines and counts where universe entries appear', () => {
    expect(parseTimeline('# T\n\n| When | Event | Book |\n|------|-------|------|\n| Year 1 | Blackout | Falls |\n| Year 2 | Trial | |\n\nAfter')).toEqual([
      { when: 'Year 1', event: 'Blackout', where: 'Falls' },
      { when: 'Year 2', event: 'Trial', where: '' }
    ])
    const { u, iron1, night1 } = makeUniverse()
    upsertBibleEntry(iron1, 'characters', 'Mara Voss', { aliases: ['Iron Saint'] }, '', 'merge', 'universe')
    writeScene(iron1, OPENING, { characters: ['Mara Voss'] }, 'Steel.')
    writeScene(night1, OPENING, {}, 'They feared the Iron Saint.')
    fs.appendFileSync(path.join(u, 'bible', 'timeline.md'), '| Year 1 | The Blackout | Iron Falls |\n')
    fs.appendFileSync(path.join(night1, 'bible', 'timeline.md'), '| Day 1 | Court opens | 1 |\n')
    const ov = universeOverview(night1)!
    expect(ov.books.map((b) => [b.title, b.path])).toEqual([
      ['Origin of Iron', `../../Iron Saint/${path.basename(iron1)}`],
      ['Iron Falls', expect.stringMatching(/^\.\.\/\.\.\/Iron Saint\//)],
      ['Gavel', '.'],
      ['The Long Night', '../../The Long Night']
    ])
    expect(ov.appearances.entries.map((e) => e.name)).toEqual(['Mara Voss'])
    expect(ov.appearances.counts[0]).toEqual([1, 0, 1, 0])
    expect(ov.chronicle.map((c) => c.source)).toEqual(['Universe', 'Gavel'])
    expect(ov.chronicle[0].rows[0]).toEqual({ when: 'Year 1', event: 'The Blackout', where: 'Iron Falls' })
    expect(ov.chronicle[1].path).toBe('bible/timeline.md')
  })
})

describe('custom bible categories', () => {
  it('starts a standalone with the default categories, and lets the author add their own', () => {
    const book = path.join(tmp, 'Book')
    scaffoldProject(book, { title: 'Book' })
    expect(listBibleCategories(book).map((c) => [c.slug, c.name])).toEqual([
      ['characters', 'Characters'],
      ['locations', 'Locations'],
      ['lore', 'Lore & World']
    ])
    const c = saveBibleCategory(book, 'Powers & Abilities', 'book', { noun: 'power', fields: ['source', 'limits'], guidance: 'Every power needs a cost.' })
    expect(c).toMatchObject({ slug: 'powers-abilities', name: 'Powers & Abilities', noun: 'power', fields: ['source', 'limits'], scopes: ['book'], path: 'bible/powers-abilities' })
    // New entries start with the category's fields; the settings file is not an entry
    const e = upsertBibleEntry(book, 'powers-abilities', 'Steel Skin', { summary: 'Hard as iron' })
    expect(e.fields).toMatchObject({ name: 'Steel Skin', source: '', limits: '', summary: 'Hard as iron' })
    expect(listBible(book, 'powers-abilities').map((x) => x.name)).toEqual(['Steel Skin'])
    expect(loadProject(book).bibleCategories.map((x) => x.slug)).toContain('powers-abilities')
    // The AI is told about the category and its guidance
    const agents = fs.readFileSync(path.join(book, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('`powers-abilities`: Powers & Abilities. Fields: source, limits. Every power needs a cost.')
    // Renaming keeps the folder and entries
    saveBibleCategory(book, 'powers-abilities', 'book', { name: 'Powers' })
    expect(listBibleCategories(book).find((x) => x.slug === 'powers-abilities')?.name).toBe('Powers')
    expect(listBible(book, 'powers-abilities')).toHaveLength(1)
  })

  it('deletes only empty categories', () => {
    const book = path.join(tmp, 'Book')
    scaffoldProject(book, { title: 'Book' })
    expect(() => deleteBibleCategory(book, 'characters')).toThrow(/still has 1 entry/)
    deleteBibleCategory(book, 'lore')
    expect(listBibleCategories(book).map((c) => c.slug)).toEqual(['characters', 'locations'])
    expect(() => deleteBibleCategory(book, 'lore')).toThrow(/No bible category/)
    expect(() => deleteBibleCategory(book, '..')).toThrow(/not a bible category/)
    expect(fs.existsSync(path.join(book, 'bible', 'timeline.md'))).toBe(true)
  })

  it('shares universe categories with every book, which adds none of its own', () => {
    const { u, iron1, night1, novella } = makeUniverse()
    // Books in a series or universe don't make their own empty category folders
    expect(fs.existsSync(path.join(night1, 'bible', 'locations'))).toBe(false)
    expect(fs.existsSync(path.join(findSeriesRoot(night1)!, 'bible', 'locations'))).toBe(false)
    saveBibleCategory(iron1, 'Teams', 'universe', { noun: 'team', fields: ['members', 'base'] })
    const teams = listBibleCategories(novella).find((c) => c.slug === 'teams')
    expect(teams).toMatchObject({ name: 'Teams', scopes: ['universe'], path: '../bible/teams' })
    expect(listBibleCategories(iron1).find((c) => c.slug === 'teams')?.path).toBe('../../bible/teams')
    // Deleting the universe's lore removes it everywhere (the new books never made their own)
    deleteBibleCategory(night1, 'lore')
    expect(fs.existsSync(path.join(u, 'bible', 'lore'))).toBe(false)
    expect(listBibleCategories(novella).map((c) => c.slug)).not.toContain('lore')
    // A category in several layers keeps the closest layer's settings
    saveBibleCategory(novella, 'teams', 'book', { name: 'Crews' })
    expect(listBibleCategories(novella).find((c) => c.slug === 'teams')).toMatchObject({ name: 'Crews', scopes: ['book', 'universe'], path: 'bible/teams' })
    expect(() => deleteBibleCategory(novella, 'teams', 'series')).toThrow(/no series bible/)
  })
})

describe('universe MCP tools', () => {
  it('gives the AI the universe, categories, appearances and layered timelines', async () => {
    const { u, iron1, night1 } = makeUniverse()
    upsertBibleEntry(iron1, 'characters', 'Mara Voss', {}, '', 'merge', 'universe')
    writeScene(iron1, OPENING, { characters: ['Mara Voss'] }, 'Steel.')
    const [a, b] = InMemoryTransport.createLinkedPair()
    await buildServer(night1).connect(a)
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(b)
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
      return { text: r.content.map((c) => c.text).join('\n'), isError: r.isError }
    }
    try {
      const ov = JSON.parse((await call('universe_overview')).text)
      expect(ov.universe.title).toBe('The Vanguard Universe')
      expect(ov.series.map((s: { title: string }) => s.title)).toEqual(['Iron Saint', 'Night Court'])
      expect(ov.standalones[0]).toMatchObject({ title: 'The Long Night', format: 'novella', folder: '../../The Long Night' })
      expect(ov.universeBible.map((e: { name: string }) => e.name)).toEqual(['Mara Voss'])

      const cats = JSON.parse((await call('bible_categories')).text)
      expect(cats.layers).toEqual(['book', 'series', 'universe'])
      expect((await call('bible_category_save', { name: 'Powers', scope: 'universe', fields: ['source'] })).text).toContain('universe bible')
      expect(fs.existsSync(path.join(u, 'bible', 'powers', '_category.md'))).toBe(true)
      expect((await call('bible_upsert', { kind: 'powers', name: 'Steel Skin', scope: 'universe' })).text).toContain('universe bible')

      const seen = JSON.parse((await call('bible_appearances', { name: 'Mara Voss' })).text)
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({ book: 'Origin of Iron', how: 'listed' })

      await call('timeline_add', { when: 'Year 1', event: 'The Blackout', chapter: 'Iron Falls', scope: 'universe' })
      expect(fs.readFileSync(path.join(u, 'bible', 'timeline.md'), 'utf8')).toContain('| Year 1 | The Blackout | Iron Falls |')
      expect((await call('style_guide_get')).text).toContain('Universe style guide')

      await call('project_update_config', { crossover: { event: 'Blackout', part: 2 } })
      expect(loadConfig(night1).crossover).toEqual({ event: 'Blackout', part: 2 })
      await call('project_update_config', { crossover: null })
      expect(loadConfig(night1).crossover).toBeUndefined()
    } finally {
      await client.close()
    }
  })
})
