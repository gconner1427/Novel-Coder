// Node-only novel project model. Used by the Electron main process and the MCP server.
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import type {
  BibleCategory,
  BibleEntry,
  BibleKind,
  BibleScope,
  BookFormat,
  BookInfo,
  CrossoverInfo,
  ChapterInfo,
  NovelConfig,
  ProjectSnapshot,
  SceneInfo,
  SceneMeta,
  SceneStatus,
  SeriesConfig,
  SeriesInfo,
  ShelfBook,
  ManuscriptText,
  UniverseConfig,
  UniverseInfo,
  UniverseSeries
} from './types'

export const CONFIG_FILE = 'novel.json'
export const HIDDEN_DIR = '.novel'
/** The categories a new bible starts with. Authors can add, rename and remove categories. */
export const BIBLE_KINDS: BibleKind[] = ['characters', 'locations', 'lore']
export const BIBLE_SCOPES: BibleScope[] = ['book', 'series', 'universe']

export const FORMAT_LABEL: Record<BookFormat, string> = { novel: 'novel', novella: 'novella', 'short-story': 'short story' }
const FORMAT_TARGET: Record<BookFormat, number> = { novel: 80000, novella: 30000, 'short-story': 7500 }

export const DEFAULT_CONFIG: NovelConfig = {
  title: 'Untitled Novel',
  author: '',
  genre: '',
  pov: 'Third person limited',
  tense: 'Past',
  targetWords: 80000,
  dailyGoal: 1000,
  defaultEngine: 'claude',
  models: { claude: 'default', codex: 'default' }
}

// ---------------- helpers ----------------

export function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled'
  )
}

export function isInside(base: string, p: string): boolean {
  const r = path.resolve(base)
  const a = path.resolve(p)
  return a === r || a.startsWith(r + path.sep)
}

/**
 * Resolve a project-relative path, refusing anything that escapes the project. Books inside a series
 * or universe may also reach the folders around them (shared bibles, outlines, other books) via ../
 */
export function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel)
  if (isInside(containerRoot(root), abs)) return abs
  throw new Error(`Path escapes project: ${rel}`)
}

/** The outermost folder a book belongs to: its universe, else its series, else the book itself. */
export function containerRoot(bookRoot: string): string {
  return findUniverseRoot(bookRoot) ?? findSeriesRoot(bookRoot) ?? path.resolve(bookRoot)
}

/** The folder to create for a title inside parent, avoiding names already taken. */
function freeFolder(parent: string, title: string, fallback: string): string {
  const base = title.replace(/[<>:"/\\|?*]+/g, '').trim() || fallback
  let dir = path.join(parent, base)
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(parent, `${base} (${n})`)
  return dir
}

// ---------------- universe ----------------
// A universe folder holds series folders and standalone books side by side, plus a universe bible
// shared by all of them. Bible layers resolve book → series → universe; the closest layer wins.

export const UNIVERSE_FILE = 'universe.json'

export const DEFAULT_UNIVERSE: UniverseConfig = {
  title: 'Untitled Universe',
  author: '',
  genre: '',
  description: '',
  pov: 'Third person limited',
  tense: 'Past'
}

export function isUniverseRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, UNIVERSE_FILE))
}

/** A book belongs to a universe when it sits directly in a universe folder, or in a series that does. */
export function findUniverseRoot(bookRoot: string): string | null {
  const self = path.resolve(bookRoot)
  const parent = path.dirname(self)
  if (parent === self) return null
  if (isUniverseRoot(parent)) return parent
  if (isSeriesRoot(parent)) {
    const grand = path.dirname(parent)
    if (grand !== parent && isUniverseRoot(grand)) return grand
  }
  return null
}

export function loadUniverseConfig(universeRoot: string): UniverseConfig {
  try {
    return { ...DEFAULT_UNIVERSE, ...JSON.parse(fs.readFileSync(path.join(universeRoot, UNIVERSE_FILE), 'utf8')) }
  } catch {
    return { ...DEFAULT_UNIVERSE }
  }
}

/** Every book in a universe, in its series and standalone. */
export function universeBookRoots(universeRoot: string): string[] {
  const u = listUniverse(universeRoot, undefined, true)
  return [...u.series.flatMap((s) => s.books.map((b) => b.root)), ...u.standalones.map((b) => b.root)]
}

export function saveUniverseConfig(universeRoot: string, cfg: UniverseConfig): void {
  writeText(path.join(universeRoot, UNIVERSE_FILE), JSON.stringify(cfg, null, 2) + '\n')
  for (const b of universeBookRoots(universeRoot)) syncAgentInstructions(b)
}

/** The series and standalone books inside a universe folder. light skips word counts. */
export function listUniverse(universeRoot: string, current?: string, light = false): { series: UniverseSeries[]; standalones: BookInfo[] } {
  const series: UniverseSeries[] = []
  const standalones: BookInfo[] = []
  for (const d of sortedDir(universeRoot)) {
    if (!d.isDirectory()) continue
    const dir = path.join(universeRoot, d.name)
    if (isSeriesRoot(dir)) {
      const sc = loadSeriesConfig(dir)
      const books = listBooks(dir, current, light)
      series.push({
        folder: d.name,
        root: dir,
        title: sc.title,
        plannedBooks: sc.plannedBooks,
        books,
        words: books.reduce((a, b) => a + b.words, 0),
        current: books.some((b) => b.current)
      })
    } else if (isNovelProject(dir)) {
      standalones.push(bookInfo(dir, standalones.length + 1, current, light))
    }
  }
  return { series, standalones }
}

/** Books that tell parts of the same crossover event, grouped by event and ordered by part. */
export function listCrossovers(universeRoot: string, current: string, light = false): CrossoverInfo[] {
  const u = listUniverse(universeRoot, current, light)
  const all = [
    ...u.series.flatMap((s) => s.books.map((b) => ({ b, seriesTitle: s.title as string | undefined }))),
    ...u.standalones.map((b) => ({ b, seriesTitle: undefined as string | undefined }))
  ]
  const events = new Map<string, CrossoverInfo>()
  for (const { b, seriesTitle } of all) {
    const ev = b.crossover?.event?.trim()
    if (!ev) continue
    const key = ev.toLowerCase()
    if (!events.has(key)) events.set(key, { event: ev, parts: [] })
    events.get(key)!.parts.push({
      part: b.crossover!.part,
      title: b.title,
      root: b.root,
      path: toPosix(path.relative(current, b.root)) || '.',
      seriesTitle,
      current: b.current
    })
  }
  for (const e of events.values()) e.parts.sort((a, b) => a.part - b.part)
  return [...events.values()].sort((a, b) => a.event.localeCompare(b.event))
}

/** light skips word counts, which read every scene of every book in the universe. */
export function loadUniverse(bookRoot: string, light = false): UniverseInfo | undefined {
  const u = findUniverseRoot(bookRoot)
  if (!u) return undefined
  const { series, standalones } = listUniverse(u, bookRoot, light)
  const prefix = toPosix(path.relative(bookRoot, u))
  const files: string[] = []
  for (const f of sortedDir(u)) {
    if (f.isFile() && f.name.endsWith('.md')) files.push(`${prefix}/${f.name}`)
  }
  for (const f of listFiles(path.join(u, 'bible'))) files.push(`${prefix}/bible/${f}`)
  return {
    root: u,
    config: loadUniverseConfig(u),
    series,
    standalones,
    crossovers: listCrossovers(u, bookRoot, true),
    totalWords: series.reduce((a, s) => a + s.words, 0) + standalones.reduce((a, b) => a + b.words, 0),
    files,
    prefix
  }
}

export interface UniverseScaffoldOptions {
  title: string
  author?: string
  genre?: string
  description?: string
  pov?: string
  tense?: string
}

/** Create an empty universe folder: settings, instructions, outline and the universe bible. Returns dir. */
export function scaffoldUniverse(dir: string, opts: UniverseScaffoldOptions): string {
  fs.mkdirSync(dir, { recursive: true })
  const cfg: UniverseConfig = {
    ...DEFAULT_UNIVERSE,
    title: opts.title,
    author: opts.author ?? '',
    genre: opts.genre ?? '',
    description: opts.description ?? '',
    pov: opts.pov || DEFAULT_UNIVERSE.pov,
    tense: opts.tense || DEFAULT_UNIVERSE.tense
  }
  const w = (rel: string, text: string) => {
    const abs = path.join(dir, rel)
    if (!fs.existsSync(abs)) writeText(abs, text)
  }
  w(UNIVERSE_FILE, JSON.stringify(cfg, null, 2) + '\n')
  w('UNIVERSE.md', UNIVERSE_MD_TEMPLATE)
  w(
    'universe-outline.md',
    `# Universe outline: ${cfg.title}\n\n## The universe\n${cfg.description || 'What this universe is, and the big story its series and standalones tell together.'}\n\n` +
      `## Eras and phases\n\n## Series and standalones\n- How each one connects to the rest: \n\n## Crossover events\n- The event, which books tell it, and in what order: \n`
  )
  w(
    'bible/style-guide.md',
    `# Universe style guide\n\nConventions every series and standalone shares. Each series can add its own voice in its own style guide.\n\n- Default POV: ${cfg.pov}\n- Default tense: ${cfg.tense}\n- Shared terminology: \n- Always true in this universe: \n`
  )
  w('bible/timeline.md', `# Universe timeline\n\n| When | Event | Book |\n|------|-------|------|\n`)
  for (const k of BIBLE_KINDS) w(`bible/${k}/.gitkeep`, '')
  return dir
}

/** Add a new series (with its first book) to a universe. Returns the first book's root. */
export function addSeriesToUniverse(universeRoot: string, opts: SeriesScaffoldOptions): string {
  const u = loadUniverseConfig(universeRoot)
  const dir = freeFolder(universeRoot, opts.seriesTitle, 'Series')
  return scaffoldSeries(dir, { author: u.author, genre: u.genre, pov: u.pov, tense: u.tense, ...stripEmpty(opts) })
}

/** Add a standalone book (novel, novella or short story) directly to a universe. Returns its root. */
export function addStandaloneToUniverse(universeRoot: string, opts: ScaffoldOptions): string {
  const u = loadUniverseConfig(universeRoot)
  const dir = freeFolder(universeRoot, opts.title, 'Book')
  scaffoldProject(dir, { author: u.author, genre: u.genre, pov: u.pov, tense: u.tense, ...stripEmpty(opts) })
  syncAround(dir)
  return dir
}

/** Refresh the instructions of every book around this one (they list each other, and share bible categories). */
export function syncAround(bookRoot: string): void {
  for (const b of relatedBooks(bookRoot)) syncAgentInstructions(b.root)
}

function stripEmpty<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T
}

export const UNIVERSE_MD_TEMPLATE = `# Universe instructions

Anything the AI should know about the whole universe: how the series and standalones connect, rules of
the world that hold everywhere, the tone shared across every book, and what must never be contradicted.
Novel Coder includes this in the CLAUDE.md and AGENTS.md of every book in the universe.
`

// ---------------- series ----------------

export const SERIES_FILE = 'series.json'

export const DEFAULT_SERIES: SeriesConfig = {
  title: 'Untitled Series',
  author: '',
  genre: '',
  description: '',
  plannedBooks: 3,
  pov: 'Third person limited',
  tense: 'Past'
}

export function isSeriesRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, SERIES_FILE))
}

/** A book belongs to a series when its parent folder holds series.json. */
export function findSeriesRoot(bookRoot: string): string | null {
  const parent = path.dirname(path.resolve(bookRoot))
  return parent !== path.resolve(bookRoot) && isSeriesRoot(parent) ? parent : null
}

export function loadSeriesConfig(seriesRoot: string): SeriesConfig {
  try {
    return { ...DEFAULT_SERIES, ...JSON.parse(fs.readFileSync(path.join(seriesRoot, SERIES_FILE), 'utf8')) }
  } catch {
    return { ...DEFAULT_SERIES }
  }
}

export function saveSeriesConfig(seriesRoot: string, cfg: SeriesConfig): void {
  writeText(path.join(seriesRoot, SERIES_FILE), JSON.stringify(cfg, null, 2) + '\n')
  for (const b of listBooks(seriesRoot)) syncAgentInstructions(b.root)
}

function premiseOf(bookRoot: string): string | undefined {
  const m = /## Premise\s*\n+([^\n#][^\n]*)/.exec(readText(path.join(bookRoot, 'outline', 'outline.md')))
  return m?.[1]?.trim()
}

/** light skips the word count, which reads every scene. */
function bookInfo(root: string, fallbackNumber: number, current?: string, light = false): BookInfo {
  const cfg = loadConfig(root)
  const folder = path.basename(root)
  return {
    folder,
    root,
    title: cfg.title,
    number: cfg.seriesNumber ?? (parseInt(folder, 10) || fallbackNumber),
    words: light ? 0 : listChapters(root).reduce((a, c) => a + c.words, 0),
    targetWords: cfg.targetWords,
    current: !!current && path.resolve(current) === path.resolve(root),
    premise: premiseOf(root),
    format: cfg.format,
    crossover: cfg.crossover
  }
}

export function listBooks(seriesRoot: string, current?: string, light = false): BookInfo[] {
  return sortedDir(seriesRoot)
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(seriesRoot, d.name, CONFIG_FILE)))
    .map((d, i) => bookInfo(path.join(seriesRoot, d.name), i + 1, current, light))
    .sort((a, b) => a.number - b.number)
}

export function loadSeries(bookRoot: string): SeriesInfo | undefined {
  const s = findSeriesRoot(bookRoot)
  if (!s) return undefined
  const books = listBooks(s, bookRoot)
  const prefix = toPosix(path.relative(bookRoot, s)) + '/'
  const files: string[] = []
  for (const f of sortedDir(s)) {
    if (f.isFile() && f.name.endsWith('.md')) files.push(prefix + f.name)
  }
  for (const f of listFiles(path.join(s, 'bible'))) files.push(`${prefix}bible/${f}`)
  return { root: s, config: loadSeriesConfig(s), books, totalWords: books.reduce((a, b) => a + b.words, 0), files }
}

export interface SeriesScaffoldOptions extends Omit<ScaffoldOptions, 'title'> {
  seriesTitle: string
  firstBookTitle: string
  plannedBooks?: number
  description?: string
}

/** Create a series folder with a shared bible, series outline and its first book. Returns the first book's root. */
export function scaffoldSeries(dir: string, opts: SeriesScaffoldOptions): string {
  fs.mkdirSync(dir, { recursive: true })
  const cfg: SeriesConfig = {
    ...DEFAULT_SERIES,
    title: opts.seriesTitle,
    author: opts.author ?? '',
    genre: opts.genre ?? '',
    description: opts.description ?? opts.premise ?? '',
    plannedBooks: opts.plannedBooks || DEFAULT_SERIES.plannedBooks,
    pov: opts.pov || DEFAULT_SERIES.pov,
    tense: opts.tense || DEFAULT_SERIES.tense
  }
  const w = (rel: string, text: string) => {
    const abs = path.join(dir, rel)
    if (!fs.existsSync(abs)) writeText(abs, text)
  }
  w(SERIES_FILE, JSON.stringify(cfg, null, 2) + '\n')
  w('SERIES.md', SERIES_MD_TEMPLATE)
  w(
    'series-outline.md',
    `# Series outline: ${cfg.title}\n\n## Series premise\n${cfg.description || 'The big story that spans every book.'}\n\n## Overarching arc\n\n` +
      Array.from({ length: cfg.plannedBooks }, (_, i) => `## Book ${i + 1}${i === 0 ? `: ${opts.firstBookTitle}` : ''}\n- Core conflict: \n- Ending / hook into next book: \n`).join('\n')
  )
  w('bible/style-guide.md', `# Series style guide\n\n- POV: ${cfg.pov}\n- Tense: ${cfg.tense}\n- Voice: \n- Recurring motifs: \n- Words/phrases to avoid: \n`)
  w('bible/timeline.md', `# Series timeline\n\n| When | Event | Book |\n|------|-------|------|\n`)
  w(
    'bible/characters/protagonist.md',
    matter.stringify('\n## Backstory\n\n## Arc across the series\n', { name: 'Protagonist', aliases: [], role: 'protagonist', summary: 'Recurring lead. Rename me and fill me in.', first_appears: 'Book 1' })
  )
  // A series in a universe uses the universe bible's categories.
  if (!isUniverseRoot(path.dirname(path.resolve(dir)))) {
    w('bible/locations/.gitkeep', '')
    w('bible/lore/.gitkeep', '')
  }
  return addBookToSeries(dir, opts.firstBookTitle, opts)
}

export function addBookToSeries(seriesRoot: string, title: string, opts: Partial<ScaffoldOptions> = {}): string {
  const s = loadSeriesConfig(seriesRoot)
  const books = listBooks(seriesRoot)
  const number = books.length ? Math.max(...books.map((b) => b.number)) + 1 : 1
  const root = path.join(seriesRoot, `${String(number).padStart(2, '0')}-${slugify(title)}`)
  scaffoldProject(root, {
    author: s.author,
    genre: s.genre,
    pov: s.pov,
    tense: s.tense,
    ...opts,
    title,
    seriesNumber: number
  })
  syncAround(root)
  return root
}

/** Turn a standalone novel into book 1 of a new series (moves the book folder into a new series folder). */
export function convertToSeries(bookRoot: string, seriesTitle: string, plannedBooks = 3): string {
  if (findSeriesRoot(bookRoot)) throw new Error('This book is already part of a series.')
  const cfg = loadConfig(bookRoot)
  const parent = path.dirname(path.resolve(bookRoot))
  let seriesDir = path.join(parent, seriesTitle.replace(/[<>:"/\\|?*]+/g, '').trim() || 'Series')
  if (path.resolve(seriesDir) === path.resolve(bookRoot) || fs.existsSync(seriesDir)) seriesDir += ' (series)'
  fs.mkdirSync(seriesDir, { recursive: true })
  const dest = path.join(seriesDir, `01-${slugify(cfg.title)}`)
  fs.renameSync(bookRoot, dest)
  saveConfig(dest, { ...cfg, seriesNumber: 1 })
  const series: SeriesConfig = { ...DEFAULT_SERIES, title: seriesTitle, author: cfg.author, genre: cfg.genre, pov: cfg.pov, tense: cfg.tense, plannedBooks }
  writeText(path.join(seriesDir, SERIES_FILE), JSON.stringify(series, null, 2) + '\n')
  writeText(path.join(seriesDir, 'SERIES.md'), SERIES_MD_TEMPLATE)
  writeText(
    path.join(seriesDir, 'series-outline.md'),
    `# Series outline: ${seriesTitle}\n\n## Series premise\n\n## Overarching arc\n\n` +
      Array.from({ length: plannedBooks }, (_, i) => `## Book ${i + 1}${i === 0 ? `: ${cfg.title}` : ''}\n- Core conflict: \n- Ending / hook into next book: \n`).join('\n')
  )
  for (const k of listBibleCategories(dest).map((c) => c.slug)) fs.mkdirSync(path.join(seriesDir, 'bible', k), { recursive: true })
  writeText(path.join(seriesDir, 'bible', 'timeline.md'), `# Series timeline\n\n| When | Event | Book |\n|------|-------|------|\n`)
  syncAgentInstructions(dest)
  return dest
}

// ---------------- bringing existing work into a universe ----------------

/** What moves when a book joins a universe: its whole series if it has one, else the book itself. */
export function movingUnit(bookRoot: string): string {
  return findSeriesRoot(bookRoot) ?? path.resolve(bookRoot)
}

/** Every book inside the unit that moves with this book (so their AI memory can be saved first). */
export function booksInUnit(bookRoot: string): string[] {
  const s = findSeriesRoot(bookRoot)
  return s ? listBooks(s, undefined, true).map((b) => b.root) : [path.resolve(bookRoot)]
}

/** Move a folder, copying across drives when a rename can't. */
function moveFolder(from: string, to: string): void {
  try {
    fs.renameSync(from, to)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    fs.cpSync(from, to, { recursive: true })
    fs.rmSync(from, { recursive: true, force: true })
  }
}

/** Move the unit (series or standalone book) into a universe folder. Returns the book's new root. */
function moveUnitInto(bookRoot: string, universeRoot: string): string {
  const unit = movingUnit(bookRoot)
  const dest = freeFolder(universeRoot, path.basename(unit), 'Book')
  const inside = path.relative(unit, path.resolve(bookRoot))
  moveFolder(unit, dest)
  const book = path.join(dest, inside)
  syncAround(book)
  return book
}

/**
 * Turn a series (with all its books), or a standalone book, into the first part of a new universe.
 * The universe folder is created next to it and it moves inside. Returns the book's new root.
 */
export function convertToUniverse(bookRoot: string, universeTitle: string, description = ''): string {
  if (findUniverseRoot(bookRoot)) throw new Error('This book is already part of a universe.')
  const unit = movingUnit(bookRoot)
  const series = findSeriesRoot(bookRoot)
  const cfg = series ? loadSeriesConfig(series) : loadConfig(bookRoot)
  // The universe starts with the categories this book uses, so entries can move up into the universe bible.
  const categories = listBibleCategories(bookRoot)
  const dir = freeFolder(path.dirname(unit), universeTitle, 'Universe')
  scaffoldUniverse(dir, { title: universeTitle, author: cfg.author, genre: cfg.genre, pov: cfg.pov, tense: cfg.tense, description })
  const book = moveUnitInto(bookRoot, dir)
  for (const c of categories) {
    if (!c.scopes.includes('universe')) saveBibleCategory(book, c.slug, 'universe', { name: c.name, noun: c.noun, fields: c.fields, guidance: c.guidance, order: c.order })
  }
  return book
}

/** Move a series (with all its books), or a standalone book, into an existing universe. Returns the book's new root. */
export function moveIntoUniverse(bookRoot: string, universeRoot: string): string {
  if (!isUniverseRoot(universeRoot)) throw new Error('That folder is not a universe (it has no universe.json).')
  if (findUniverseRoot(bookRoot)) throw new Error('This book is already part of a universe.')
  if (isInside(movingUnit(bookRoot), universeRoot)) throw new Error('A universe cannot be moved inside itself.')
  return moveUnitInto(bookRoot, universeRoot)
}

// ---------------- reading order, chronicle and appearances ----------------

export interface OrderedBook {
  root: string
  /** Path relative to the universe folder (what the saved reading order stores). */
  key: string
  title: string
  seriesTitle?: string
  number?: number
  format: BookFormat
  crossover?: { event: string; part: number }
  current: boolean
}

/** Every book in the universe in the author's reading order. Books not in the saved order follow, series by series. */
export function universeReadingOrder(universeRoot: string, current?: string): OrderedBook[] {
  const l = listUniverse(universeRoot, current, true)
  const all: OrderedBook[] = [
    ...l.series.flatMap((s) => s.books.map((b) => ({ b, seriesTitle: s.title as string | undefined }))),
    ...l.standalones.map((b) => ({ b, seriesTitle: undefined as string | undefined }))
  ].map(({ b, seriesTitle }) => ({
    root: b.root,
    key: toPosix(path.relative(universeRoot, b.root)),
    title: b.title,
    seriesTitle,
    number: seriesTitle ? b.number : undefined,
    format: b.format ?? 'novel',
    crossover: b.crossover,
    current: b.current
  }))
  const saved = loadUniverseConfig(universeRoot).readingOrder ?? []
  const rank = (k: string) => {
    const i = saved.indexOf(k)
    return i < 0 ? saved.length : i
  }
  return all.map((b, i) => ({ b, i })).sort((x, y) => rank(x.b.key) - rank(y.b.key) || x.i - y.i).map((x) => x.b)
}

export function saveReadingOrder(universeRoot: string, keys: string[]): void {
  saveUniverseConfig(universeRoot, { ...loadUniverseConfig(universeRoot), readingOrder: keys })
}

export interface TimelineRow {
  when: string
  event: string
  where: string
}

/** Rows of the first markdown table in a timeline file (the header and separator rows are skipped). */
export function parseTimeline(text: string): TimelineRow[] {
  const rows: string[][] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith('|')) {
      if (rows.length) break
      continue
    }
    rows.push(t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
  }
  return rows
    .slice(1)
    .filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c) || c === ''))
    .map((r) => ({ when: r[0] ?? '', event: r[1] ?? '', where: r[2] ?? '' }))
}

export interface UniverseOverview {
  universe: string
  books: (OrderedBook & { path: string; words: number })[]
  chronicle: { source: string; path: string; rows: TimelineRow[] }[]
  appearances: { entries: { name: string; kind: string; path: string }[]; counts: number[][] }
}

/**
 * The universe at a glance: books in reading order, every timeline (universe, then each series and book in
 * reading order), and how many scenes of each book each universe-bible entry appears in.
 * Paths are relative to the open book.
 */
export function universeOverview(root: string): UniverseOverview | undefined {
  const u = findUniverseRoot(root)
  if (!u) return undefined
  const rel = (abs: string) => toPosix(path.relative(root, abs)) || '.'
  const order = universeReadingOrder(u, root)
  const entries = listBible(root, undefined, ['universe'])
  const matchers = entries.map((e) => {
    const names = [e.name, ...e.aliases].map((n) => n.trim()).filter((n) => n.length >= 2)
    return { lower: names.map((n) => n.toLowerCase()), res: names.map((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')) }
  })
  const counts = entries.map(() => order.map(() => 0))
  const books = order.map((b, bi) => {
    let words = 0
    for (const sc of listChapters(b.root).flatMap((c) => c.scenes)) {
      words += sc.words
      const listed = [...(sc.characters ?? []), sc.pov ?? '', sc.location ?? ''].map((x) => x.trim().toLowerCase())
      let body: string | null = null
      matchers.forEach((m, ei) => {
        if (m.lower.some((n) => listed.includes(n))) return void counts[ei][bi]++
        body ??= readScene(b.root, sc.path).body
        if (m.res.some((re) => re.test(body!))) counts[ei][bi]++
      })
    }
    return { ...b, path: rel(b.root), words }
  })
  const chronicle: UniverseOverview['chronicle'] = []
  const add = (source: string, file: string) => {
    const rows = parseTimeline(readText(file))
    if (rows.length) chronicle.push({ source, path: rel(file), rows })
  }
  add('Universe', path.join(u, 'bible', 'timeline.md'))
  const seenSeries = new Set<string>()
  for (const b of order) {
    const s = findSeriesRoot(b.root)
    if (s && !seenSeries.has(s)) {
      seenSeries.add(s)
      add(`${loadSeriesConfig(s).title} (series)`, path.join(s, 'bible', 'timeline.md'))
    }
    add(b.title, path.join(b.root, 'bible', 'timeline.md'))
  }
  return {
    universe: loadUniverseConfig(u).title,
    books,
    chronicle,
    appearances: { entries: entries.map((e) => ({ name: e.name, kind: e.kind, path: e.path })), counts }
  }
}

export const SERIES_MD_TEMPLATE = `# Series instructions

Anything the AI should know about the whole series: the long arc, rules of the world that never
change, how books should connect (standalone-ish vs. cliffhangers), tone across the series.
Novel Coder includes this in every book's CLAUDE.md and AGENTS.md.
`

export function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

export function writeText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}

/** Write a file only if its content would change. */
export function writeIfChanged(file: string, text: string): boolean {
  if (readText(file) === text) return false
  writeText(file, text)
  return true
}

/** Count words in prose, ignoring YAML frontmatter, markdown markup and HTML comments. */
export function countWords(text: string): number {
  let body = text
  if (body.startsWith('---')) {
    try {
      body = matter(body).content
    } catch {
      /* ignore malformed frontmatter */
    }
  }
  body = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, ' ')
    .replace(/^\s*-{3,}\s*$/gm, ' ')
    .replace(/[#>*_`~|]+/g, ' ')
  const m = body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
  return m ? m.length : 0
}

function titleFromFolder(folder: string): string {
  const t = folder.replace(/^\d+[-_ ]*/, '').replace(/[-_]+/g, ' ').trim()
  return t ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : folder
}

function sortedDir(dir: string): fs.Dirent[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  } catch {
    return []
  }
}

// ---------------- config ----------------

export function isNovelProject(root: string): boolean {
  return fs.existsSync(path.join(root, CONFIG_FILE))
}

export function loadConfig(root: string): NovelConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8'))
    return { ...DEFAULT_CONFIG, ...raw, models: { ...DEFAULT_CONFIG.models, ...(raw.models ?? {}) } }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(root: string, cfg: NovelConfig): void {
  writeText(path.join(root, CONFIG_FILE), JSON.stringify(cfg, null, 2) + '\n')
  syncAgentInstructions(root)
}

// ---------------- manuscript ----------------

export function parseScene(root: string, rel: string, chapter = '', chapterTitle = ''): SceneInfo {
  const abs = resolveInside(root, rel)
  const text = readText(abs)
  let data: Record<string, unknown> = {}
  try {
    data = matter(text).data
  } catch {
    /* ignore */
  }
  const base = path.basename(rel, '.md')
  return {
    path: toPosix(rel),
    chapter,
    chapterTitle,
    title: String(data.title ?? titleFromFolder(base)),
    pov: data.pov ? String(data.pov) : undefined,
    status: (data.status as SceneStatus) ?? 'drafted',
    summary: data.summary ? String(data.summary) : undefined,
    location: data.location ? String(data.location) : undefined,
    time: data.time ? String(data.time) : undefined,
    characters: Array.isArray(data.characters) ? data.characters.map(String) : undefined,
    words: countWords(text)
  }
}

export function listChapters(root: string): ChapterInfo[] {
  const ms = path.join(root, 'manuscript')
  const chapters: ChapterInfo[] = []
  for (const d of sortedDir(ms)) {
    if (!d.isDirectory()) continue
    const folder = d.name
    let title = titleFromFolder(folder)
    const metaFile = path.join(ms, folder, '_chapter.md')
    if (fs.existsSync(metaFile)) {
      try {
        const t = matter(readText(metaFile)).data.title
        if (t) title = String(t)
      } catch {
        /* ignore */
      }
    }
    const scenes = sortedDir(path.join(ms, folder))
      .filter((f) => f.isFile() && f.name.endsWith('.md') && f.name !== '_chapter.md')
      .map((f) => parseScene(root, `manuscript/${folder}/${f.name}`, folder, title))
    chapters.push({ folder, title, scenes, words: scenes.reduce((a, s) => a + s.words, 0) })
  }
  return chapters
}

export function readScene(root: string, rel: string): { meta: SceneMeta; body: string } {
  const text = readText(resolveInside(root, rel))
  const parsed = matter(text)
  const d = parsed.data as Partial<SceneMeta>
  return {
    meta: { title: d.title ?? path.basename(rel, '.md'), status: d.status ?? 'drafted', ...d },
    body: parsed.content.replace(/^\n+/, '')
  }
}

export function writeScene(root: string, rel: string, meta: Partial<SceneMeta>, body: string): SceneInfo {
  const abs = resolveInside(root, rel)
  let existing: Record<string, unknown> = {}
  if (fs.existsSync(abs)) {
    try {
      existing = matter(readText(abs)).data
    } catch {
      /* ignore */
    }
  }
  const data = Object.fromEntries(
    Object.entries({ ...existing, ...meta }).filter(([, v]) => v !== undefined && v !== '')
  )
  writeText(abs, matter.stringify('\n' + body.trim() + '\n', data))
  const parts = toPosix(rel).split('/')
  return parseScene(root, rel, parts[1] ?? '', titleFromFolder(parts[1] ?? ''))
}

export function nextNumber(names: string[]): string {
  const nums = names.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n))
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0')
}

export function createChapter(root: string, title: string): string {
  const ms = path.join(root, 'manuscript')
  fs.mkdirSync(ms, { recursive: true })
  const folder = `${nextNumber(sortedDir(ms).map((d) => d.name))}-${slugify(title)}`
  writeText(path.join(ms, folder, '_chapter.md'), matter.stringify('\n', { title }))
  return folder
}

export function createScene(root: string, chapterFolder: string, title: string, meta: Partial<SceneMeta> = {}): string {
  const dir = resolveInside(root, `manuscript/${chapterFolder}`)
  fs.mkdirSync(dir, { recursive: true })
  const names = sortedDir(dir).filter((d) => d.name !== '_chapter.md').map((d) => d.name)
  const rel = `manuscript/${chapterFolder}/${nextNumber(names)}-${slugify(title)}.md`
  writeScene(root, rel, { title, status: 'idea', ...meta }, '')
  return rel
}

/** Full manuscript as ordered markdown (used by export and AI read-through). */
export function compileManuscript(root: string, opts: { sceneBreak?: string } = {}): { title: string; chapters: { title: string; text: string }[] } {
  const cfg = loadConfig(root)
  const brk = opts.sceneBreak ?? '\n\n#\n\n'
  return {
    title: cfg.title,
    chapters: listChapters(root).map((ch) => ({
      title: ch.title,
      text: ch.scenes.map((s) => readScene(root, s.path).body.trim()).filter(Boolean).join(brk)
    }))
  }
}

/** The manuscript (or one chapter, by folder) in reading order, scene by scene. Empty scenes are left out. */
export function readManuscript(root: string, chapterFolder?: string): ManuscriptText {
  const cfg = loadConfig(root)
  return {
    title: cfg.title,
    author: cfg.author,
    chapters: listChapters(root)
      .filter((ch) => !chapterFolder || ch.folder === chapterFolder)
      .map((ch) => ({
        folder: ch.folder,
        title: ch.title,
        words: ch.words,
        scenes: ch.scenes
          .map((s) => ({ path: s.path, title: s.title, words: s.words, body: readScene(root, s.path).body.trim() }))
          .filter((s) => s.body)
      }))
  }
}

// ---------------- story bible ----------------
// A book's bible lives in <book>/bible. When the book is part of a series, the series bible in
// <series>/bible is merged in (scope "series"), and in a universe the universe bible too (scope
// "universe"). Their paths are given relative to the book (../bible/…, ../../bible/…).
// Each category is a folder under bible/. An optional bible/<category>/_category.md holds its display
// name, the singular noun, the fields new entries start with, and (as its body) guidance on what to record.

const CATEGORY_FILE = '_category.md'

const DEFAULT_CATEGORY_META: Record<string, { name: string; noun: string; fields: string[]; order: number }> = {
  characters: { name: 'Characters', noun: 'character', fields: [], order: 0 },
  locations: { name: 'Locations', noun: 'location', fields: [], order: 1 },
  lore: { name: 'Lore & World', noun: 'lore entry', fields: [], order: 2 }
}

function bibleBase(root: string, scope: BibleScope): { dir: string; prefix: string } | null {
  if (scope === 'book') return { dir: root, prefix: '' }
  const s = scope === 'series' ? findSeriesRoot(root) : findUniverseRoot(root)
  if (!s) return null
  return { dir: s, prefix: toPosix(path.relative(root, s)) + '/' }
}

/** The bible layers this book can see, closest first. */
export function bibleScopes(root: string): BibleScope[] {
  return BIBLE_SCOPES.filter((s) => bibleBase(root, s))
}

function categoryDirs(base: string): string[] {
  return sortedDir(path.join(base, 'bible'))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((x) => x.trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean)
  return []
}

/** Every category in the bibles this book can see, merged across layers (the closest layer's settings win). */
export function listBibleCategories(root: string): BibleCategory[] {
  const out = new Map<string, BibleCategory>()
  for (const scope of bibleScopes(root)) {
    const base = bibleBase(root, scope)!
    for (const slug of categoryDirs(base.dir)) {
      const known = out.get(slug)
      if (known) {
        known.scopes.push(scope)
        continue
      }
      const file = path.join(base.dir, 'bible', slug, CATEGORY_FILE)
      let data: Record<string, unknown> = {}
      let guidance = ''
      if (fs.existsSync(file)) {
        try {
          const m = matter(readText(file))
          data = m.data
          guidance = m.content.trim()
        } catch {
          /* ignore malformed category file */
        }
      }
      const def = DEFAULT_CATEGORY_META[slug]
      out.set(slug, {
        slug,
        name: String(data.name ?? def?.name ?? titleFromFolder(slug)),
        noun: String(data.noun ?? def?.noun ?? 'entry'),
        fields: data.fields !== undefined ? asList(data.fields) : def?.fields ?? [],
        guidance,
        order: typeof data.order === 'number' ? data.order : def?.order,
        scopes: [scope],
        path: `${base.prefix}bible/${slug}`
      })
    }
  }
  return [...out.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name))
}

export interface CategoryOptions {
  name?: string
  noun?: string
  fields?: string[]
  guidance?: string
  order?: number
}

/** Create a bible category in one layer (or update its settings there). Returns the category. */
export function saveBibleCategory(root: string, slugOrName: string, scope: BibleScope, opts: CategoryOptions = {}): BibleCategory {
  const base = bibleBase(root, scope)
  if (!base) throw new Error(`This book has no ${scope} bible.`)
  const existing = listBibleCategories(root).find((c) => c.slug === slugOrName || c.name.toLowerCase() === slugOrName.toLowerCase())
  const slug = existing?.slug ?? slugify(slugOrName)
  if (slug.startsWith('_')) throw new Error('Category names cannot start with an underscore.')
  const dir = path.join(base.dir, 'bible', slug)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, CATEGORY_FILE)
  const prev = fs.existsSync(file) ? matter(readText(file)) : { data: {} as Record<string, unknown>, content: '' }
  const data: Record<string, unknown> = {
    ...prev.data,
    name: opts.name ?? prev.data.name ?? existing?.name ?? (DEFAULT_CATEGORY_META[slug]?.name || slugOrName.trim()),
    noun: opts.noun ?? prev.data.noun ?? existing?.noun ?? 'entry',
    fields: opts.fields ?? (prev.data.fields !== undefined ? asList(prev.data.fields) : existing?.fields ?? []),
    ...(opts.order !== undefined ? { order: opts.order } : {})
  }
  const guidance = opts.guidance ?? (prev.content.trim() || existing?.guidance || '')
  writeText(file, matter.stringify('\n' + guidance.trim() + '\n', data))
  syncAround(root)
  return listBibleCategories(root).find((c) => c.slug === slug)!
}

/**
 * Remove a category from one layer, or from every layer when scope is left out. Refuses (and removes
 * nothing) while any of those layers still has entries in it.
 */
export function deleteBibleCategory(root: string, slug: string, scope?: BibleScope): void {
  const dirs: { scope: BibleScope; dir: string }[] = []
  for (const sc of scope ? [scope] : bibleScopes(root)) {
    const base = bibleBase(root, sc)
    if (!base) throw new Error(`This book has no ${sc} bible.`)
    const bible = path.join(base.dir, 'bible')
    const dir = path.join(bible, slug)
    if (!slug || path.dirname(path.resolve(dir)) !== path.resolve(bible)) throw new Error(`"${slug}" is not a bible category.`)
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) dirs.push({ scope: sc, dir })
  }
  if (!dirs.length) throw new Error(`No bible category "${slug}".`)
  for (const { scope: sc, dir } of dirs) {
    // Anything but the category's own settings file (and hidden placeholders) counts as content to keep.
    const n = sortedDir(dir).filter((f) => f.name !== CATEGORY_FILE).length
    if (n) throw new Error(`The ${sc} bible still has ${n} ${n === 1 ? 'entry' : 'entries'} in this category. Move or delete them first.`)
  }
  for (const { dir } of dirs) fs.rmSync(dir, { recursive: true, force: true })
  syncAround(root)
}

export function parseBibleEntry(root: string, kind: BibleKind, file: string, scope: BibleScope = 'book'): BibleEntry {
  const base = bibleBase(root, scope) ?? { dir: root, prefix: '' }
  const rel = `${base.prefix}bible/${kind}/${file}`
  const parsed = matter(readText(path.join(base.dir, 'bible', kind, file)))
  const d = parsed.data as Record<string, unknown>
  const slug = path.basename(file, '.md')
  return {
    kind,
    slug,
    path: rel,
    name: String(d.name ?? titleFromFolder(slug)),
    aliases: Array.isArray(d.aliases) ? d.aliases.map(String) : [],
    summary: String(d.summary ?? ''),
    fields: d,
    body: parsed.content.trim(),
    scope
  }
}

/** Entries in every visible layer, closest layer first (book, series, universe). */
export function listBible(root: string, kind?: BibleKind, scopes: BibleScope[] = BIBLE_SCOPES): BibleEntry[] {
  const out: BibleEntry[] = []
  for (const scope of BIBLE_SCOPES.filter((s) => scopes.includes(s))) {
    const base = bibleBase(root, scope)
    if (!base) continue
    for (const k of kind ? [kind] : categoryDirs(base.dir)) {
      for (const f of sortedDir(path.join(base.dir, 'bible', k))) {
        if (f.isFile() && f.name.endsWith('.md') && !f.name.startsWith('_')) out.push(parseBibleEntry(root, k, f.name, scope))
      }
    }
  }
  return out
}

/** Book entries take precedence over series entries with the same name, and series over universe. */
export function findBibleEntry(root: string, nameOrSlug: string): BibleEntry | undefined {
  const q = nameOrSlug.toLowerCase()
  return listBible(root).find(
    (e) => e.slug === slugify(q) || e.name.toLowerCase() === q || e.aliases.some((a) => a.toLowerCase() === q)
  )
}

export function searchBible(root: string, query: string): BibleEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return listBible(root)
    .map((e) => {
      const hay = `${e.name} ${e.aliases.join(' ')} ${e.summary} ${e.body}`.toLowerCase()
      const score = terms.reduce((a, t) => a + (hay.includes(t) ? 1 : 0) + (e.name.toLowerCase().includes(t) ? 2 : 0), 0)
      return { e, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.e)
}

/**
 * Create or update a bible entry. scope "series" / "universe" writes to that shared bible; if omitted,
 * an existing entry is updated wherever it lives, and new entries go into the book. A new entry
 * starts with its category's fields.
 */
export function upsertBibleEntry(
  root: string,
  kind: BibleKind,
  name: string,
  fields: Record<string, unknown> = {},
  body?: string,
  mode: 'merge' | 'replace' = 'merge',
  scope?: BibleScope
): BibleEntry {
  kind = slugify(kind)
  const existing = findBibleEntry(root, name)
  const target: BibleScope = scope ?? (existing && existing.kind === kind ? existing.scope : 'book')
  const base = bibleBase(root, target)
  if (!base) throw new Error(`This book is not part of a ${target}, so there is no ${target} bible.`)
  const sameEntry = existing && existing.kind === kind && existing.scope === target
  const slug = sameEntry ? existing!.slug : slugify(name)
  const abs = path.join(base.dir, 'bible', kind, `${slug}.md`)
  const isNew = !fs.existsSync(abs)
  const prev = isNew ? { data: {}, content: '' } : matter(readText(abs))
  const template = isNew
    ? Object.fromEntries((listBibleCategories(root).find((c) => c.slug === kind)?.fields ?? []).map((f) => [f, '']))
    : {}
  const data = mode === 'replace' ? { name, ...template, ...fields } : { ...template, ...prev.data, name, ...fields }
  const content = body !== undefined ? body : prev.content
  writeText(abs, matter.stringify('\n' + String(content).trim() + '\n', data))
  return parseBibleEntry(root, kind, `${slug}.md`, target)
}

/** Bible entries whose name or aliases appear in the given text. */
export function entriesMentioned(root: string, text: string): BibleEntry[] {
  const lower = text.toLowerCase()
  return listBible(root).filter((e) =>
    [e.name, ...e.aliases].some((n) => {
      if (!n || n.length < 2) return false
      const re = new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      return re.test(lower)
    })
  )
}

/** Everything an agent needs to keep a scene consistent with the rest of the book. */
export function continuityContext(root: string, sceneRel: string): string {
  const { meta, body } = readScene(root, sceneRel)
  const chapters = listChapters(root)
  const flat = chapters.flatMap((c) => c.scenes)
  const idx = flat.findIndex((s) => s.path === toPosix(sceneRel))
  const prev = idx > 0 ? flat[idx - 1] : undefined
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : undefined
  const mentioned = entriesMentioned(root, `${body}\n${(meta.characters ?? []).join(' ')}\n${meta.location ?? ''}\n${meta.pov ?? ''}`)
  const timeline = readText(path.join(root, 'bible', 'timeline.md'))
  const style = readText(path.join(root, 'bible', 'style-guide.md'))
  const series = findSeriesRoot(root)
  const seriesParts: string[] = []
  if (series) {
    const cfg = loadConfig(root)
    const books = listBooks(series, root, true)
    const earlier = books.filter((b) => b.number < (cfg.seriesNumber ?? Infinity))
    seriesParts.push(`## Series: ${loadSeriesConfig(series).title} (this is book ${cfg.seriesNumber ?? '?'} of ${books.length})`)
    for (const b of earlier) {
      const sums = listChapters(b.root)
        .flatMap((c) => c.scenes.map((sc) => sc.summary).filter(Boolean))
        .slice(-12)
      seriesParts.push([`### Earlier book ${b.number}: ${b.title}`, b.premise ?? '', ...sums.map((x) => `- ${x}`)].join('\n'))
    }
    const sTimeline = readText(path.join(series, 'bible', 'timeline.md'))
    const sStyle = readText(path.join(series, 'bible', 'style-guide.md'))
    if (sTimeline) seriesParts.push(`## Series timeline\n${sTimeline}`)
    if (sStyle) seriesParts.push(`## Series style guide\n${sStyle}`)
  }
  const universe = findUniverseRoot(root)
  if (universe) {
    const cfg = loadConfig(root)
    seriesParts.push(`## Universe: ${loadUniverseConfig(universe).title} (${series ? `this book is in the series ${loadSeriesConfig(series).title}` : `this is a standalone ${FORMAT_LABEL[cfg.format ?? 'novel']}`})`)
    const ev = cfg.crossover?.event?.trim().toLowerCase()
    const crossover = ev ? listCrossovers(universe, root, true).find((c) => c.event.toLowerCase() === ev) : undefined
    if (crossover) {
      const me = cfg.crossover!.part
      seriesParts.push(
        `## Crossover: ${crossover.event} (this book is part ${me} of ${crossover.parts.length})\n` +
          crossover.parts.map((p) => `- Part ${p.part}: ${p.title}${p.seriesTitle ? ` (${p.seriesTitle})` : ' (standalone)'} at ${p.path}${p.current ? ' (this book)' : ''}`).join('\n')
      )
      for (const p of crossover.parts.filter((x) => !x.current)) {
        const sums = listChapters(p.root).flatMap((c) => c.scenes.map((sc) => sc.summary).filter(Boolean))
        if (p.part < me) seriesParts.push([`### Earlier crossover part ${p.part}: ${p.title}`, premiseOf(p.root) ?? '', ...sums.slice(-12).map((x) => `- ${x}`)].join('\n'))
        else seriesParts.push([`### Later crossover part ${p.part}: ${p.title}`, premiseOf(p.root) ?? ''].join('\n'))
      }
    }
    const uTimeline = readText(path.join(universe, 'bible', 'timeline.md'))
    const uStyle = readText(path.join(universe, 'bible', 'style-guide.md'))
    if (uTimeline) seriesParts.push(`## Universe timeline\n${uTimeline}`)
    if (uStyle) seriesParts.push(`## Universe style guide\n${uStyle}`)
  }
  const parts = [
    `# Continuity context for ${sceneRel}`,
    `Scene: ${meta.title} | POV: ${meta.pov ?? '?'} | Status: ${meta.status} | Location: ${meta.location ?? '?'} | Time: ${meta.time ?? '?'}`,
    prev ? `Previous scene (${prev.path}): ${prev.summary ?? '(no summary)'}` : 'This is the first scene.',
    next ? `Next scene (${next.path}): ${next.summary ?? '(no summary)'}` : '',
    '## Story bible entries referenced',
    ...mentioned.map((e) => `### ${e.name} (${e.kind}${e.scope !== 'book' ? `, ${e.scope} bible` : ''})\n${yamlish(e.fields)}\n${e.body}`),
    timeline ? `## Timeline\n${timeline}` : '',
    style ? `## Style guide\n${style}` : '',
    ...seriesParts
  ]
  return parts.filter(Boolean).join('\n\n')
}

/** Every book this book can see: itself, its series and, in a universe, every series and standalone. */
export function relatedBooks(root: string): { root: string; title: string; seriesTitle?: string }[] {
  const u = findUniverseRoot(root)
  if (u) {
    const l = listUniverse(u, root, true)
    return [
      ...l.series.flatMap((s) => s.books.map((b) => ({ root: b.root, title: b.title, seriesTitle: s.title }))),
      ...l.standalones.map((b) => ({ root: b.root, title: b.title }))
    ]
  }
  const s = findSeriesRoot(root)
  if (s) {
    const title = loadSeriesConfig(s).title
    return listBooks(s, root, true).map((b) => ({ root: b.root, title: b.title, seriesTitle: title }))
  }
  return [{ root: path.resolve(root), title: loadConfig(root).title }]
}

export interface Appearance {
  book: string
  seriesTitle?: string
  /** Scene path relative to the open book. */
  path: string
  scene: string
  summary?: string
  /** "listed" when the scene's frontmatter names it (characters, pov or location), "mentioned" when only the prose does. */
  how: 'listed' | 'mentioned'
}

/** Scenes across every related book where a bible entry (or any name) appears, in reading order per book. */
export function findAppearances(root: string, nameOrSlug: string): Appearance[] {
  const e = findBibleEntry(root, nameOrSlug)
  const names = (e ? [e.name, ...e.aliases] : [nameOrSlug]).map((n) => n.trim()).filter((n) => n.length >= 2)
  const lower = names.map((n) => n.toLowerCase())
  const res = names.map((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'))
  const out: Appearance[] = []
  for (const b of relatedBooks(root)) {
    for (const sc of listChapters(b.root).flatMap((c) => c.scenes)) {
      const listed = [...(sc.characters ?? []), sc.pov ?? '', sc.location ?? ''].some((x) => lower.includes(x.trim().toLowerCase()))
      const mentioned = !listed && res.some((re) => re.test(readScene(b.root, sc.path).body))
      if (!listed && !mentioned) continue
      out.push({
        book: b.title,
        seriesTitle: b.seriesTitle,
        path: toPosix(path.relative(root, path.join(b.root, sc.path))),
        scene: sc.title,
        summary: sc.summary,
        how: listed ? 'listed' : 'mentioned'
      })
    }
  }
  return out
}

function yamlish(o: Record<string, unknown>): string {
  return Object.entries(o)
    .filter(([k]) => k !== 'name')
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('\n')
}

// ---------------- whole-project snapshot ----------------

export function listFiles(root: string, dir = '', out: string[] = []): string[] {
  for (const d of sortedDir(path.join(root, dir))) {
    if (d.name === 'node_modules') continue
    const rel = dir ? `${dir}/${d.name}` : d.name
    if (d.isDirectory()) listFiles(root, rel, out)
    else out.push(rel)
  }
  return out
}

/** A light summary of a book for the Welcome shelf. Never throws: a missing or broken folder comes back with exists: false. */
export function shelfBook(root: string): ShelfBook {
  const fallback = path.basename(root)
  if (!isNovelProject(root)) return { root, exists: false, title: fallback, author: '', genre: '', words: 0, targetWords: 0, scenes: 0 }
  try {
    const cfg = loadConfig(root)
    const chapters = listChapters(root)
    const s = findSeriesRoot(root)
    return {
      root,
      exists: true,
      title: cfg.title || fallback,
      author: cfg.author,
      genre: cfg.genre,
      words: chapters.reduce((a, c) => a + c.words, 0),
      targetWords: cfg.targetWords,
      scenes: chapters.reduce((a, c) => a + c.scenes.length, 0),
      premise: premiseOf(root),
      seriesTitle: s ? loadSeriesConfig(s).title : undefined,
      seriesNumber: s ? cfg.seriesNumber : undefined,
      universeTitle: (() => {
        const u = findUniverseRoot(root)
        return u ? loadUniverseConfig(u).title : undefined
      })(),
      format: cfg.format
    }
  } catch {
    return { root, exists: false, title: fallback, author: '', genre: '', words: 0, targetWords: 0, scenes: 0 }
  }
}

export function loadProject(root: string): ProjectSnapshot {
  const chapters = listChapters(root)
  return {
    root,
    config: loadConfig(root),
    chapters,
    bible: listBible(root),
    bibleCategories: listBibleCategories(root),
    totalWords: chapters.reduce((a, c) => a + c.words, 0),
    files: listFiles(root),
    series: loadSeries(root),
    // Light: a save re-reads the project, and word counts would read every book in the universe.
    universe: loadUniverse(root, true)
  }
}

// ---------------- agent instructions ----------------

export const NOVEL_MD_TEMPLATE = `# Author's instructions

Write anything here you want the AI to always know about this book: tone, themes, things to avoid,
how you like feedback delivered, and so on. Novel Coder copies this into CLAUDE.md and AGENTS.md
so both Claude and Codex read it automatically.

- Never change the author's chosen character names or plot facts without asking.
- Match the voice described in bible/style-guide.md.
`

/** Regenerate CLAUDE.md and AGENTS.md (both engines' native instruction files) from NOVEL.md + novel.json. */
export function syncAgentInstructions(root: string): void {
  const cfg = loadConfig(root)
  const author = readText(path.join(root, 'NOVEL.md')) || NOVEL_MD_TEMPLATE
  const seriesText = seriesInstructions(root, cfg) + universeInstructions(root, cfg)
  const text = `<!-- Generated by Novel Coder from NOVEL.md and novel.json. Edit NOVEL.md instead. -->
# Novel project: ${cfg.title}

You are working inside a **novel-writing project**, not a software project. You are a skilled fiction
collaborator: co-writer, developmental editor, line editor and continuity checker.

## Book facts
- Title: ${cfg.title}${cfg.author ? `\n- Author: ${cfg.author}` : ''}${cfg.genre ? `\n- Genre: ${cfg.genre}` : ''}${cfg.format && cfg.format !== 'novel' ? `\n- Format: ${FORMAT_LABEL[cfg.format]}` : ''}
- Point of view: ${cfg.pov}
- Tense: ${cfg.tense}
- Target length: ${cfg.targetWords.toLocaleString()} words

## Project layout
- \`manuscript/NN-chapter-slug/NN-scene-slug.md\`: scenes, with YAML frontmatter (title, pov, status, summary, location, time, characters). \`_chapter.md\` holds the chapter title.
- \`bible/<category>/*.md\`: story bible entries (YAML frontmatter + prose). The author decides the categories; \`bible/<category>/_category.md\` holds a category's settings and guidance.
${categoryInstructions(root)}
- \`bible/timeline.md\`, \`bible/style-guide.md\`: chronology and voice rules.
- \`outline/outline.md\`, \`outline/beats.md\`: plot outline and beat sheet.
- \`notes/\`: freeform research and notes. \`.novel/reports/\`: continuity and editorial reports.

## Working rules
1. Before drafting or revising a scene, consult the story bible and the neighbouring scenes (use the \`novel\` MCP tools: continuity_context, bible_search, scene_list).
2. Preserve scene frontmatter. Update \`status\` and \`summary\` when you draft or revise a scene.
3. When you introduce a new named character, place, or rule of the world, add or update its bible entry.
4. Write prose, not outlines, when asked to draft. Show, don't tell; respect the POV and tense above.
5. Never delete the author's prose without being asked; prefer targeted edits.
6. Put critiques and continuity reports in \`.novel/reports/\` as markdown, citing file paths and quoting the passage.

## Author's own instructions
${author}
${seriesText}`
  // Memory travels with the book in .novel/ai (Novel Coder syncs it between devices).
  // Claude keeps its own memory notes, which Novel Coder mirrors there; Codex reads and adds to the same notes.
  const claudeMemory = `
## Novel Coder files
Don't edit \`.novel/ai/\` yourself. Novel Coder copies your memory and chats there so they follow the author to their other devices.
`
  const codexMemory = `
## Your memory for this book
Notes about this author and this book, shared with the other AI the author uses, are kept in \`.novel/ai/memory/\`.
- At the start of each conversation, read \`.novel/ai/memory/MEMORY.md\` (the index) and the notes it lists that are relevant, and follow them.
- When you learn something that should still matter in a future conversation (the author's preferences and corrections, decisions about the story, facts they told you, ideas they rejected), save it as one short note per fact: a file in \`.novel/ai/memory/\` with YAML frontmatter (\`name\`, \`description\`, \`metadata.type\`: user, feedback, project or reference) and the fact in the body. Add a one-line link to it in MEMORY.md.
- Update or delete notes that turn out to be wrong. Don't save what the manuscript or story bible already records.
- Don't touch \`.novel/ai/chats/\` or \`.novel/ai/manifest.json\`.
`
  // Only write when the content changed, so opening a book doesn't make the watcher reload it.
  writeIfChanged(path.join(root, 'CLAUDE.md'), text + claudeMemory)
  writeIfChanged(path.join(root, 'AGENTS.md'), text + codexMemory)
}

function seriesInstructions(root: string, cfg: NovelConfig): string {
  const seriesRoot = findSeriesRoot(root)
  if (!seriesRoot) return ''
  const sc = loadSeriesConfig(seriesRoot)
  const books = listBooks(seriesRoot, root, true)
  const bt = '`'
  const lines = [
    '',
    '## This book is part of a series',
    `- Series: **${sc.title}**. This is book ${cfg.seriesNumber ?? '?'} (${sc.plannedBooks} planned).`,
    sc.description ? `- Series premise: ${sc.description}` : '',
    `- Books: ${books.map((b) => `${b.number}. ${b.title} (${bt}../${b.folder}/${bt})`).join('; ')}`,
    `- Shared series files live one folder up: ${bt}../series-outline.md${bt} (the arc across books), ${bt}../SERIES.md${bt} (series instructions),`,
    `  ${bt}../bible/${bt} (the **series bible**: recurring characters, places and world rules, plus ${bt}../bible/timeline.md${bt} and ${bt}../bible/style-guide.md${bt}).`,
    `- The novel MCP bible tools search both bibles. Use ${bt}bible_upsert${bt} with ${bt}scope: "series"${bt} for anything that recurs across books and`,
    `  ${bt}scope: "book"${bt} for things that only matter in this book. Use ${bt}series_overview${bt} to see every book.`,
    `- Stay consistent with earlier books: read their scene summaries (or scenes under ${bt}../NN-book/manuscript/${bt}) before writing callbacks,`,
    '  never contradict established series facts, and plant threads that the series outline says pay off later.',
    '',
    '## Series instructions',
    readText(path.join(seriesRoot, 'SERIES.md')) || SERIES_MD_TEMPLATE
  ]
  return lines.filter((l) => l !== '').join('\n') + '\n'
}

/** The bible's categories, with where each lives and the author's guidance, for the instruction files. */
function categoryInstructions(root: string): string {
  const cats = listBibleCategories(root)
  if (!cats.length) return '- The bible has no categories yet.'
  return cats
    .map((c) => {
      const where = c.scopes.length === 1 && c.scopes[0] === 'book' ? '' : ` [${c.scopes.join(', ')} bible${c.scopes.length > 1 ? 's' : ''}]`
      const fields = c.fields.length ? ` Fields: ${c.fields.join(', ')}.` : ''
      const guide = c.guidance ? ` ${c.guidance.replace(/\s*\n\s*/g, ' ')}` : ''
      return `  - \`${c.slug}\`: ${c.name}${where}.${fields}${guide}`
    })
    .join('\n')
}

function universeInstructions(root: string, cfg: NovelConfig): string {
  const u = findUniverseRoot(root)
  if (!u) return ''
  const uc = loadUniverseConfig(u)
  const l = listUniverse(u, root, true)
  const series = findSeriesRoot(root)
  const pre = toPosix(path.relative(root, u))
  const rel = (abs: string) => toPosix(path.relative(root, abs))
  const bt = '`'
  const where = series
    ? `book ${cfg.seriesNumber ?? '?'} of the series **${loadSeriesConfig(series).title}**`
    : `a standalone ${FORMAT_LABEL[cfg.format ?? 'novel']} (not part of any series)`
  const lines = [
    '',
    '## This book is part of a shared universe',
    `- Universe: **${uc.title}**. This book is ${where}.`,
    uc.description ? `- Universe premise: ${uc.description}` : '',
    ...l.series.map((s) => `- Series **${s.title}** (${bt}${rel(s.root)}/${bt}): ${s.books.map((b) => `${b.number}. ${b.title}`).join('; ') || 'no books yet'}`),
    l.standalones.length
      ? `- Standalones: ${l.standalones.map((b) => `${b.title}${b.format && b.format !== 'novel' ? ` (${FORMAT_LABEL[b.format]})` : ''} (${bt}${rel(b.root)}/${bt})`).join('; ')}`
      : '',
    uc.readingOrder?.length
      ? `- Reading order (as the author wants readers to read them): ${universeReadingOrder(u, root)
          .map((b, i) => `${i + 1}. ${b.title}${b.seriesTitle ? ` (${b.seriesTitle} ${b.number})` : ''}${b.current ? ' (this book)' : ''}`)
          .join('; ')}`
      : '',
    `- Shared universe files: ${bt}${pre}/universe-outline.md${bt} (how everything connects), ${bt}${pre}/UNIVERSE.md${bt} (universe instructions),`,
    `  ${bt}${pre}/bible/${bt} (the **universe bible**: characters, places, groups and rules shared across every series and standalone, plus ${bt}${pre}/bible/timeline.md${bt} and ${bt}${pre}/bible/style-guide.md${bt}).`,
    `- Bible layers: this book${series ? ', then its series' : ''}, then the universe. When the same name exists in more than one, the closest layer wins (a book or series can keep its own version of a universe character).`,
    `  Use ${bt}bible_upsert${bt} with ${bt}scope: "universe"${bt} for anything that appears in more than one series or standalone (crossing characters, teams, organisations, world events, rules of the world)${series ? `, ${bt}scope: "series"${bt} for what recurs only in this series,` : ','} and ${bt}scope: "book"${bt} for this book only.`,
    `- Use ${bt}universe_overview${bt} to see every series and book, and ${bt}bible_appearances${bt} to see every scene in the universe where a character or place already appears before you write them.`,
    '- Never contradict what other books in the universe have established. Characters who cross over must keep their history, voice and powers consistent with where they last appeared.'
  ]
  const ev = cfg.crossover?.event?.trim().toLowerCase()
  const crossover = ev ? listCrossovers(u, root, true).find((c) => c.event.toLowerCase() === ev) : undefined
  if (crossover) {
    lines.push(
      '',
      `## Crossover: ${crossover.event}`,
      `This book is part ${cfg.crossover!.part} of the crossover event "${crossover.event}", told across these books:`,
      ...crossover.parts.map((p) => `- Part ${p.part}: ${p.title}${p.seriesTitle ? ` (${p.seriesTitle})` : ' (standalone)'}, ${bt}${p.path}/${bt}${p.current ? ' (this book)' : ''}`),
      'Read the earlier parts (their scene summaries, and their final scenes) before writing, pick up exactly where they leave off, and set up what the later parts need.'
    )
  }
  lines.push('', '## Universe instructions', readText(path.join(u, 'UNIVERSE.md')) || UNIVERSE_MD_TEMPLATE)
  return lines.filter((x) => x !== '').join('\n') + '\n'
}

// ---------------- scaffolding ----------------

export const BEAT_SHEETS: Record<string, string> = {
  'save-the-cat': `# Beat sheet: Save the Cat

1. **Opening Image** (0–1%):
2. **Theme Stated** (5%):
3. **Set-Up** (1–10%):
4. **Catalyst** (10%):
5. **Debate** (10–20%):
6. **Break into Two** (20%):
7. **B Story** (22%):
8. **Fun and Games** (20–50%):
9. **Midpoint** (50%):
10. **Bad Guys Close In** (50–75%):
11. **All Is Lost** (75%):
12. **Dark Night of the Soul** (75–80%):
13. **Break into Three** (80%):
14. **Finale** (80–99%):
15. **Final Image** (99–100%):
`,
  'three-act': `# Beat sheet: Three-Act Structure

## Act I: Setup
- Hook:
- Inciting incident:
- First plot point:

## Act II: Confrontation
- Rising action:
- Midpoint reversal:
- Second plot point / crisis:

## Act III: Resolution
- Climax:
- Resolution:
`,
  'heros-journey': `# Beat sheet: The Hero's Journey

1. Ordinary World:
2. Call to Adventure:
3. Refusal of the Call:
4. Meeting the Mentor:
5. Crossing the Threshold:
6. Tests, Allies, Enemies:
7. Approach to the Inmost Cave:
8. The Ordeal:
9. Reward:
10. The Road Back:
11. Resurrection:
12. Return with the Elixir:
`
}

export interface ScaffoldOptions {
  title: string
  author?: string
  genre?: string
  pov?: string
  tense?: string
  targetWords?: number
  dailyGoal?: number
  beatSheet?: keyof typeof BEAT_SHEETS
  premise?: string
  seriesNumber?: number
  format?: BookFormat
  crossover?: { event: string; part: number }
}

export function scaffoldProject(root: string, opts: ScaffoldOptions): void {
  fs.mkdirSync(root, { recursive: true })
  const cfg: NovelConfig = {
    ...DEFAULT_CONFIG,
    title: opts.title,
    author: opts.author ?? '',
    genre: opts.genre ?? '',
    pov: opts.pov || DEFAULT_CONFIG.pov,
    tense: opts.tense || DEFAULT_CONFIG.tense,
    targetWords: opts.targetWords || FORMAT_TARGET[opts.format ?? 'novel'],
    dailyGoal: opts.dailyGoal || DEFAULT_CONFIG.dailyGoal,
    ...(opts.seriesNumber ? { seriesNumber: opts.seriesNumber } : {}),
    ...(opts.format && opts.format !== 'novel' ? { format: opts.format } : {}),
    ...(opts.crossover?.event?.trim() ? { crossover: { event: opts.crossover.event.trim(), part: opts.crossover.part || 1 } } : {})
  }
  const inSeries = !!findSeriesRoot(root)
  const universe = findUniverseRoot(root)
  const w = (rel: string, text: string) => {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) writeText(abs, text)
  }
  w(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n')
  w('NOVEL.md', NOVEL_MD_TEMPLATE)
  w(
    'outline/outline.md',
    `# Outline: ${opts.title}\n\n## Premise\n${opts.premise ?? 'One or two sentences: who wants what, what stands in the way, and what is at stake.'}\n\n## Act I\n\n## Act II\n\n## Act III\n`
  )
  w('outline/beats.md', BEAT_SHEETS[opts.beatSheet ?? 'save-the-cat'])
  // In a series, the style guide and recurring characters live in the shared series bible.
  if (!inSeries)
    w(
      'bible/style-guide.md',
      `# Style guide\n\n- POV: ${cfg.pov}\n- Tense: ${cfg.tense}\n- Voice: \n- Sentence rhythm: \n- Dialogue conventions: \n- Words/phrases to avoid: \n- Comparable authors/books: \n`
    )
  w(
    'bible/timeline.md',
    inSeries
      ? `# Timeline for this book\n\nSeries-wide events go in ../bible/timeline.md.\n\n| When | Event | Chapter |\n|------|-------|---------|\n`
      : universe
        ? `# Timeline for this book\n\nUniverse-wide events go in ../bible/timeline.md.\n\n| When | Event | Chapter |\n|------|-------|---------|\n`
        : `# Timeline\n\n| When | Event | Chapter |\n|------|-------|---------|\n`
  )
  if (!inSeries)
    w(
      'bible/characters/protagonist.md',
      matter.stringify(
        '\n## Backstory\n\n## Voice & mannerisms\n\n## Arc\n',
        { name: 'Protagonist', aliases: [], role: 'protagonist', age: '', appearance: '', want: '', need: '', flaw: '', summary: 'Rename me and fill me in.' }
      )
    )
  // A book in a series or universe uses the categories of the shared bibles; its own category
  // folders appear when it gets its first book-only entry.
  if (!inSeries && !universe) for (const k of BIBLE_KINDS) w(`bible/${k}/.gitkeep`, '')
  w('notes/research.md', '# Research notes\n')
  w(`${HIDDEN_DIR}/commands/example.md`, `---\ndescription: Example custom command. Rewrites the given passage in a noir voice.\nargs: <scene path or text>\n---\nRewrite the following in a hard-boiled noir voice, keeping every plot fact intact:\n\n$ARGUMENTS\n`)
  w(`${HIDDEN_DIR}/reports/.gitkeep`, '')
  if (!fs.existsSync(path.join(root, 'manuscript'))) {
    const ch = createChapter(root, 'Chapter One')
    createScene(root, ch, 'Opening', { summary: 'The first scene.' })
  }
  syncAgentInstructions(root)
}
