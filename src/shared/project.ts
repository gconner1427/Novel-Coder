// Node-only novel project model. Used by the Electron main process and the MCP server.
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import type {
  BibleEntry,
  BibleKind,
  BookInfo,
  ChapterInfo,
  NovelConfig,
  ProjectSnapshot,
  SceneInfo,
  SceneMeta,
  SceneStatus,
  SeriesConfig,
  SeriesInfo,
  ShelfBook
} from './types'

export const CONFIG_FILE = 'novel.json'
export const HIDDEN_DIR = '.novel'
export const BIBLE_KINDS: BibleKind[] = ['characters', 'locations', 'lore']

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

/**
 * Resolve a project-relative path, refusing anything that escapes the project root. Books inside
 * a series may also reach the series folder (shared bible, series outline, sibling books) via ../
 */
export function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel)
  const inside = (base: string) => {
    const r = path.resolve(base)
    return abs === r || abs.startsWith(r + path.sep)
  }
  if (inside(root)) return abs
  const s = findSeriesRoot(root)
  if (s && inside(s)) return abs
  throw new Error(`Path escapes project: ${rel}`)
}

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

export function listBooks(seriesRoot: string, current?: string): BookInfo[] {
  return sortedDir(seriesRoot)
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(seriesRoot, d.name, CONFIG_FILE)))
    .map((d, i) => {
      const root = path.join(seriesRoot, d.name)
      const cfg = loadConfig(root)
      return {
        folder: d.name,
        root,
        title: cfg.title,
        number: cfg.seriesNumber ?? (parseInt(d.name, 10) || i + 1),
        words: listChapters(root).reduce((a, c) => a + c.words, 0),
        targetWords: cfg.targetWords,
        current: !!current && path.resolve(current) === path.resolve(root),
        premise: premiseOf(root)
      }
    })
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
  w('bible/locations/.gitkeep', '')
  w('bible/lore/.gitkeep', '')
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
  for (const k of BIBLE_KINDS) fs.mkdirSync(path.join(seriesDir, 'bible', k), { recursive: true })
  writeText(path.join(seriesDir, 'bible', 'timeline.md'), `# Series timeline\n\n| When | Event | Book |\n|------|-------|------|\n`)
  syncAgentInstructions(dest)
  return dest
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

// ---------------- story bible ----------------
// A book's bible lives in <book>/bible. When the book is part of a series, the series bible in
// <series>/bible is merged in (scope "series"); its paths are given relative to the book as ../bible/…

function bibleBase(root: string, scope: 'book' | 'series'): { dir: string; prefix: string } | null {
  if (scope === 'book') return { dir: root, prefix: '' }
  const s = findSeriesRoot(root)
  if (!s) return null
  return { dir: s, prefix: toPosix(path.relative(root, s)) + '/' }
}

export function parseBibleEntry(root: string, kind: BibleKind, file: string, scope: 'book' | 'series' = 'book'): BibleEntry {
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

export function listBible(root: string, kind?: BibleKind, scopes: ('book' | 'series')[] = ['book', 'series']): BibleEntry[] {
  const kinds = kind ? [kind] : BIBLE_KINDS
  const out: BibleEntry[] = []
  for (const scope of scopes) {
    const base = bibleBase(root, scope)
    if (!base) continue
    for (const k of kinds) {
      for (const f of sortedDir(path.join(base.dir, 'bible', k))) {
        if (f.isFile() && f.name.endsWith('.md')) out.push(parseBibleEntry(root, k, f.name, scope))
      }
    }
  }
  return out
}

/** Book entries take precedence over series entries with the same name. */
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
 * Create or update a bible entry. scope "series" writes to the shared series bible; if omitted,
 * an existing entry is updated wherever it lives, and new entries go into the book.
 */
export function upsertBibleEntry(
  root: string,
  kind: BibleKind,
  name: string,
  fields: Record<string, unknown> = {},
  body?: string,
  mode: 'merge' | 'replace' = 'merge',
  scope?: 'book' | 'series'
): BibleEntry {
  const existing = findBibleEntry(root, name)
  const target: 'book' | 'series' = scope ?? (existing && existing.kind === kind ? existing.scope : 'book')
  const base = bibleBase(root, target)
  if (!base) throw new Error('This book is not part of a series, so there is no series bible.')
  const sameEntry = existing && existing.kind === kind && existing.scope === target
  const slug = sameEntry ? existing!.slug : slugify(name)
  const abs = path.join(base.dir, 'bible', kind, `${slug}.md`)
  const prev = fs.existsSync(abs) ? matter(readText(abs)) : { data: {}, content: '' }
  const data = mode === 'replace' ? { name, ...fields } : { ...prev.data, name, ...fields }
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
    const books = listBooks(series, root)
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
  const parts = [
    `# Continuity context for ${sceneRel}`,
    `Scene: ${meta.title} | POV: ${meta.pov ?? '?'} | Status: ${meta.status} | Location: ${meta.location ?? '?'} | Time: ${meta.time ?? '?'}`,
    prev ? `Previous scene (${prev.path}): ${prev.summary ?? '(no summary)'}` : 'This is the first scene.',
    next ? `Next scene (${next.path}): ${next.summary ?? '(no summary)'}` : '',
    '## Story bible entries referenced',
    ...mentioned.map((e) => `### ${e.name} (${e.kind}${e.scope === 'series' ? ', series bible' : ''})\n${yamlish(e.fields)}\n${e.body}`),
    timeline ? `## Timeline\n${timeline}` : '',
    style ? `## Style guide\n${style}` : '',
    ...seriesParts
  ]
  return parts.filter(Boolean).join('\n\n')
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
      seriesNumber: s ? cfg.seriesNumber : undefined
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
    totalWords: chapters.reduce((a, c) => a + c.words, 0),
    files: listFiles(root),
    series: loadSeries(root)
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
  const seriesText = seriesInstructions(root, cfg)
  const text = `<!-- Generated by Novel Coder from NOVEL.md and novel.json. Edit NOVEL.md instead. -->
# Novel project: ${cfg.title}

You are working inside a **novel-writing project**, not a software project. You are a skilled fiction
collaborator: co-writer, developmental editor, line editor and continuity checker.

## Book facts
- Title: ${cfg.title}${cfg.author ? `\n- Author: ${cfg.author}` : ''}${cfg.genre ? `\n- Genre: ${cfg.genre}` : ''}
- Point of view: ${cfg.pov}
- Tense: ${cfg.tense}
- Target length: ${cfg.targetWords.toLocaleString()} words

## Project layout
- \`manuscript/NN-chapter-slug/NN-scene-slug.md\`: scenes, with YAML frontmatter (title, pov, status, summary, location, time, characters). \`_chapter.md\` holds the chapter title.
- \`bible/characters|locations|lore/*.md\`: story bible entries (YAML frontmatter + prose).
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
  const books = listBooks(seriesRoot, root)
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
    targetWords: opts.targetWords || DEFAULT_CONFIG.targetWords,
    dailyGoal: opts.dailyGoal || DEFAULT_CONFIG.dailyGoal,
    ...(opts.seriesNumber ? { seriesNumber: opts.seriesNumber } : {})
  }
  const inSeries = !!findSeriesRoot(root)
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
  else w('bible/characters/.gitkeep', '')
  w('bible/locations/.gitkeep', '')
  w('bible/lore/.gitkeep', '')
  w('notes/research.md', '# Research notes\n')
  w(`${HIDDEN_DIR}/commands/example.md`, `---\ndescription: Example custom command. Rewrites the given passage in a noir voice.\nargs: <scene path or text>\n---\nRewrite the following in a hard-boiled noir voice, keeping every plot fact intact:\n\n$ARGUMENTS\n`)
  w(`${HIDDEN_DIR}/reports/.gitkeep`, '')
  if (!fs.existsSync(path.join(root, 'manuscript'))) {
    const ch = createChapter(root, 'Chapter One')
    createScene(root, ch, 'Opening', { summary: 'The first scene.' })
  }
  syncAgentInstructions(root)
}
