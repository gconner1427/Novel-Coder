import type {
  AuthStatus,
  BibleCategory,
  BibleEntry,
  BibleScope,
  BibleKind,
  BrainstormSummary,
  IdeaFields,
  SeriesConfig,
  ChapterInfo,
  EngineEvent,
  EngineId,
  EngineSettings,
  ExportFormat,
  NovelConfig,
  PermissionMode,
  PermissionResponse,
  ProjectSnapshot,
  ShelfBook,
  ManuscriptText,
  SceneInfo,
  SceneMeta,
  SendOptions,
  SessionRecord,
  SessionSummary,
  SlashCommand,
  Snapshot,
  StatsFile,
  UpdateStatus
} from '@shared/types'

export interface AppSettings {
  recent: string[]
  theme: 'dark' | 'light' | 'system'
  lastProject?: string
  editorFont: 'serif' | 'sans' | 'mono'
  editorWidth: number
  lastSeenVersion?: string
}

export interface ScaffoldOptions {
  title: string
  author?: string
  genre?: string
  pov?: string
  tense?: string
  targetWords?: number
  dailyGoal?: number
  beatSheet?: 'save-the-cat' | 'three-act' | 'heros-journey'
  premise?: string
  kind?: 'novel' | 'series'
  seriesTitle?: string
  plannedBooks?: number
  description?: string
}

export interface AiSyncResult {
  direction: 'save' | 'load' | 'both'
  saved: { chats: number; memory: number }
  loaded: { chats: number; memory: number; removed: number }
  fromDevices: string[]
  at: number
}

export interface AiSyncStatus {
  thisDevice: string
  lastSave?: number
  lastLoad?: number
  lastLoadFrom: string[]
  devices: { name: string; lastSave: number; thisDevice: boolean }[]
  chats: number
  memoryNotes: number
  memoryDir: string
}

export interface BrainstormRecord {
  meta: { id: string; title: string; created: number; updated: number; engine: EngineId }
  session: SessionRecord | null
  ideas: string
  dir: string
}

export interface NovelApi {
  app: {
    getSettings(): Promise<AppSettings>
    setSettings(p: Partial<AppSettings>): Promise<AppSettings>
    pickFolder(title: string): Promise<string | null>
    pickImages(): Promise<string[]>
    saveTempImage(name: string, data: ArrayBuffer): Promise<string>
    openPath(p: string): Promise<string>
    showInFolder(p: string): Promise<void>
    openExternal(url: string): Promise<void>
    version(): Promise<string>
    pathForFile(f: File): string
  }
  project: {
    open(dir: string): Promise<ProjectSnapshot>
    create(dir: string, opts: ScaffoldOptions): Promise<ProjectSnapshot>
    current(): Promise<ProjectSnapshot | null>
    /** Recently opened books, newest first, summarised for the Welcome shelf. */
    shelf(): Promise<ShelfBook[]>
    /** The whole manuscript, or one chapter by folder, compiled for reading. */
    readManuscript(chapter?: string): Promise<ManuscriptText>
    close(): Promise<void>
    readFile(rel: string): Promise<string>
    writeFile(rel: string, text: string): Promise<void>
    deleteFile(rel: string): Promise<void>
    renameFile(rel: string, newRel: string): Promise<void>
    readScene(rel: string): Promise<{ meta: SceneMeta; body: string }>
    readDoc(rel: string): Promise<{ data: Record<string, unknown>; body: string; hasFrontmatter: boolean }>
    writeDoc(rel: string, data: Record<string, unknown>, body: string): Promise<void>
    writeScene(rel: string, meta: Partial<SceneMeta>, body: string): Promise<SceneInfo>
    createChapter(title: string): Promise<string>
    createScene(chapter: string, title: string): Promise<string>
    renameChapter(folder: string, title: string): Promise<void>
    reorderScenes(chapter: string, ordered: string[]): Promise<ChapterInfo[]>
    moveScene(rel: string, toChapter: string): Promise<string>
    saveConfig(cfg: NovelConfig): Promise<void>
    onChanged(cb: (p: ProjectSnapshot) => void): () => void
  }
  bible: {
    upsert(kind: BibleKind, name: string, fields: Record<string, unknown>, body: string, scope?: BibleScope): Promise<BibleEntry>
    saveCategory(slugOrName: string, scope: BibleScope, opts: { name?: string; noun?: string; fields?: string[]; guidance?: string; order?: number }): Promise<BibleCategory>
    /** Without a scope, removes the category from every bible that has it (only while they are all empty). */
    deleteCategory(slug: string, scope?: BibleScope): Promise<void>
  }
  series: {
    addBook(title: string): Promise<ProjectSnapshot>
    openBook(bookRoot: string): Promise<ProjectSnapshot>
    saveConfig(cfg: SeriesConfig): Promise<void>
    convert(seriesTitle: string, plannedBooks: number): Promise<ProjectSnapshot>
  }
  brainstorm: {
    list(): Promise<BrainstormSummary[]>
    create(engine: EngineId): Promise<BrainstormRecord>
    open(id: string): Promise<BrainstormRecord>
    close(): Promise<void>
    saveSession(id: string, s: SessionRecord): Promise<void>
    delete(id: string): Promise<void>
    ideas(id: string): Promise<{ text: string; fields: IdeaFields } | null>
    writeIdeas(id: string, text: string): Promise<void>
    convert(id: string, dir: string, opts: ScaffoldOptions): Promise<{ project: ProjectSnapshot; session: SessionRecord | null }>
    onChanged(cb: (p: { id: string; text: string; fields: IdeaFields }) => void): () => void
  }
  stats: { get(): Promise<{ stats: StatsFile; streak: number }> }
  snapshots: { list(): Promise<Snapshot[]>; create(msg: string): Promise<string | null>; restore(oid: string): Promise<void> }
  reports: { list(): Promise<{ path: string; name: string; mtime: number }[]> }
  exporter: { run(format: ExportFormat, askPath: boolean): Promise<{ file: string; words: number } | null> }
  sessions: {
    list(): Promise<SessionSummary[]>
    load(id: string): Promise<SessionRecord | null>
    save(s: SessionRecord): Promise<void>
    delete(id: string): Promise<void>
  }
  commands: { list(): Promise<SlashCommand[]>; expand(name: string, args: string): Promise<string | null> }
  auth: { status(): Promise<AuthStatus>; login(e: EngineId): Promise<void> }
  aisync: {
    status(): Promise<AiSyncStatus | null>
    save(): Promise<AiSyncResult>
    load(): Promise<AiSyncResult>
    onResult(cb: (p: { result?: AiSyncResult; error?: string; manual: boolean }) => void): () => void
  }
  updates: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    download(): Promise<void>
    install(): Promise<void>
    onStatus(cb: (s: UpdateStatus) => void): () => void
  }
  engine: {
    codexModels(): Promise<import('@shared/types').CodexCatalog>
    start(s: EngineSettings, resumeSessionId?: string): Promise<void>
    send(m: SendOptions): Promise<void>
    interrupt(): Promise<void>
    setMode(m: PermissionMode): Promise<void>
    setModel(m: string): Promise<void>
    setEffort(e: string): Promise<void>
    respond(r: PermissionResponse): Promise<void>
    close(): Promise<void>
    onEvent(cb: (p: { engine: EngineId; ev: EngineEvent }) => void): () => void
  }
}

declare global {
  interface Window {
    novel: NovelApi
  }
}

export const api: NovelApi = window.novel

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
