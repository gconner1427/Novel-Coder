// Types shared between main, preload, renderer and the MCP server.

export type EngineId = 'claude' | 'codex'

/** Unified permission modes; each engine maps them onto its own controls. */
export type PermissionMode = 'ask' | 'acceptEdits' | 'plan' | 'auto'

export interface NovelConfig {
  title: string
  author: string
  genre: string
  pov: string
  tense: string
  targetWords: number
  dailyGoal: number
  defaultEngine: EngineId
  models: { claude: string; codex: string }
  /** Position in a series (only for books that live inside a series folder). */
  seriesNumber?: number
  /** Novel (default), novella or short story. */
  format?: BookFormat
  /** For a book that is one part of a crossover event told across several series or standalones in a universe. */
  crossover?: CrossoverRef
}

export type BookFormat = 'novel' | 'novella' | 'short-story'

export interface CrossoverRef {
  /** The event's name; books with the same name (ignoring case) are parts of the same crossover. */
  event: string
  part: number
}

/** A shared universe: a folder holding several series and standalone books, with a universe-wide bible. */
export interface UniverseConfig {
  title: string
  author: string
  genre: string
  description: string
  pov: string
  tense: string
  /** Books in the order readers should read them: paths relative to the universe folder. Books not listed follow. */
  readingOrder?: string[]
}

export interface SeriesConfig {
  title: string
  author: string
  genre: string
  description: string
  plannedBooks: number
  pov: string
  tense: string
}

export interface BookInfo {
  folder: string
  root: string // absolute
  title: string
  number: number
  words: number
  targetWords: number
  current: boolean
  premise?: string
  format?: BookFormat
  crossover?: CrossoverRef
}

/** A chapter or the whole manuscript, compiled for reading, keeping track of which scene each passage came from. */
export interface ManuscriptText {
  title: string
  author: string
  chapters: {
    folder: string
    title: string
    words: number
    scenes: { path: string; title: string; words: number; body: string }[]
  }[]
}

/** What the Welcome shelf shows for a recently opened book (read without opening it). */
export interface ShelfBook {
  root: string
  /** False when the folder has been moved or deleted. */
  exists: boolean
  title: string
  author: string
  genre: string
  words: number
  targetWords: number
  scenes: number
  premise?: string
  seriesTitle?: string
  seriesNumber?: number
  universeTitle?: string
  format?: BookFormat
}

export interface SeriesInfo {
  root: string
  config: SeriesConfig
  books: BookInfo[]
  totalWords: number
  /** Series-level files, relative to the current book root (prefixed with ../). */
  files: string[]
}

export interface UniverseSeries {
  folder: string
  root: string
  title: string
  plannedBooks: number
  books: BookInfo[]
  words: number
  /** The open book belongs to this series. */
  current: boolean
}

export interface CrossoverPart {
  part: number
  title: string
  root: string
  /** Path of the book relative to the open book. */
  path: string
  seriesTitle?: string
  current: boolean
}

export interface CrossoverInfo {
  event: string
  parts: CrossoverPart[]
}

export interface UniverseInfo {
  root: string
  config: UniverseConfig
  series: UniverseSeries[]
  /** Books that live directly in the universe, outside any series. */
  standalones: BookInfo[]
  crossovers: CrossoverInfo[]
  totalWords: number
  /** Universe-level files, relative to the current book root. Word counts are 0 in a project snapshot (it skips them for speed). */
  files: string[]
  /** Path from the open book to the universe folder, e.g. ".." or "../.." */
  prefix: string
}

export interface BrainstormSummary {
  id: string
  title: string
  updated: number
  engine: EngineId
  dir: string
}

export interface IdeaFields {
  title?: string
  genre?: string
  pov?: string
  tense?: string
  premise?: string
  series?: boolean
  plannedBooks?: number
}

export type SceneStatus = 'idea' | 'outlined' | 'drafted' | 'revised' | 'final'

export interface SceneMeta {
  title: string
  pov?: string
  status: SceneStatus
  summary?: string
  location?: string
  time?: string
  characters?: string[]
}

export interface SceneInfo extends SceneMeta {
  path: string // relative to project root, forward slashes
  chapter: string // chapter folder name
  chapterTitle: string
  words: number
}

export interface ChapterInfo {
  folder: string
  title: string
  scenes: SceneInfo[]
  words: number
}

/** A story bible category: the folder name under bible/ (e.g. "characters", "powers"). Authors create their own. */
export type BibleKind = string

/** Which bible an entry lives in. The closest layer wins: book, then series, then universe. */
export type BibleScope = 'book' | 'series' | 'universe'

export interface BibleCategory {
  slug: string
  name: string
  /** Singular name for one entry, e.g. "character". */
  noun: string
  /** Fields every new entry in this category starts with. */
  fields: string[]
  /** What the author wants recorded in this category (also shown to the AI). */
  guidance: string
  order?: number
  /** The bible layers that have this category's folder, closest first. */
  scopes: BibleScope[]
  /** The category's folder in the closest of those layers, relative to the book (e.g. "../bible/powers"). Its settings live in _category.md there. */
  path: string
}

export interface BibleEntry {
  kind: BibleKind
  slug: string
  path: string
  name: string
  aliases: string[]
  summary: string
  fields: Record<string, unknown>
  body: string
  /** 'series' entries live in the series folder and are shared by every book; 'universe' entries by every book in the universe. */
  scope: BibleScope
}

export interface ProjectSnapshot {
  root: string
  config: NovelConfig
  chapters: ChapterInfo[]
  bible: BibleEntry[]
  bibleCategories: BibleCategory[]
  totalWords: number
  files: string[] // all non-hidden files, relative
  series?: SeriesInfo
  universe?: UniverseInfo
}

export interface DailyStat {
  date: string // YYYY-MM-DD
  startWords: number
  endWords: number
}

export interface StatsFile {
  days: DailyStat[]
}

// ---------- Engine events (normalized across Claude + Codex) ----------

export type EngineEvent =
  | { type: 'session'; engine: EngineId; sessionId: string; model?: string; models?: string[]; tools?: string[] }
  | { type: 'text-delta'; messageId: string; text: string }
  | { type: 'text'; messageId: string; text: string } // full replacement
  | { type: 'thinking'; messageId: string; text: string; delta?: boolean }
  | { type: 'tool-start'; toolId: string; name: string; input: unknown; parentToolId?: string | null }
  | { type: 'tool-end'; toolId: string; output: string; isError?: boolean }
  | { type: 'file-change'; toolId: string; path: string; kind: 'add' | 'update' | 'delete'; before?: string; after?: string }
  | { type: 'todos'; items: { text: string; status: 'pending' | 'in_progress' | 'completed' }[] }
  | { type: 'permission'; requestId: string; tool: string; input: unknown; kind: 'tool' | 'plan' | 'question' }
  | { type: 'usage'; inputTokens: number; outputTokens: number; costUsd?: number }
  | { type: 'status'; text: string }
  | { type: 'turn-start' }
  | { type: 'done'; result?: string; isError?: boolean }
  | { type: 'error'; message: string }

export interface PermissionResponse {
  requestId: string
  decision: 'allow' | 'allowAlways' | 'deny'
  message?: string
  /** For AskUserQuestion: question -> answer */
  answers?: Record<string, string>
}

export interface SendOptions {
  text: string
  images?: string[] // absolute file paths
}

export interface EngineSettings {
  engine: EngineId
  model: string
  permissionMode: PermissionMode
  effort?: string
}

/** Model metadata from the same Codex runtime that runs conversations. */
export interface CodexModel {
  id: string
  displayName: string
  description: string
  defaultReasoningEffort: string
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[]
  isDefault: boolean
}

export interface CodexCatalog {
  models: CodexModel[]
  defaultModel?: string
  /** User/project configuration override, when set. */
  configuredEffort?: string
}

// ---------- Chat transcript (persisted per UI session) ----------

export type ChatItem =
  | { kind: 'user'; id: string; text: string; images?: string[]; engine: EngineId; ts: number }
  | { kind: 'assistant'; id: string; text: string; engine: EngineId; ts: number }
  | { kind: 'thinking'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      name: string
      input: unknown
      output?: string
      isError?: boolean
      done: boolean
      parentToolId?: string | null
      changes?: { path: string; kind: string; before?: string; after?: string }[]
    }
  | { kind: 'permission'; id: string; tool: string; input: unknown; permKind: 'tool' | 'plan' | 'question'; resolved?: string }
  | { kind: 'notice'; id: string; text: string; level: 'info' | 'error' }

export interface SessionRecord {
  id: string
  title: string
  created: number
  updated: number
  engine: EngineId
  engineSessions: Partial<Record<EngineId, string>>
  items: ChatItem[]
}

export interface SessionSummary {
  id: string
  title: string
  updated: number
  engine: EngineId
}

export interface UpdateStatus {
  state: 'idle' | 'unsupported' | 'checking' | 'none' | 'available' | 'downloading' | 'downloaded' | 'error'
  /** The running version. */
  current: string
  /** The newer version, when there is one. */
  version?: string
  notes?: string
  releaseDate?: string
  percent?: number
  checkedAt?: number
  message?: string
}

export interface AuthStatus {
  claude: { installed: boolean; loggedIn: boolean; detail: string }
  codex: { installed: boolean; loggedIn: boolean; detail: string }
}

export interface SlashCommand {
  name: string
  description: string
  args?: string
  kind: 'prompt' | 'local'
  source: 'builtin' | 'project'
}

export interface Snapshot {
  oid: string
  message: string
  timestamp: number
}

export type ExportFormat = 'md' | 'docx' | 'epub' | 'pdf'
