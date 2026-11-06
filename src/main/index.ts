import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import matter from 'gray-matter'
import {
  createChapter,
  createScene,
  isNovelProject,
  listChapters,
  loadConfig,
  loadProject,
  shelfBook,
  readManuscript,
  readScene,
  readText,
  resolveInside,
  saveConfig,
  scaffoldProject,
  syncAgentInstructions,
  upsertBibleEntry,
  writeScene,
  writeText,
  nextNumber,
  scaffoldSeries,
  addBookToSeries,
  convertToSeries,
  findSeriesRoot,
  listBooks,
  loadSeriesConfig,
  saveSeriesConfig,
  type ScaffoldOptions,
  type SeriesScaffoldOptions
} from '@shared/project'
import { createSnapshot, listSnapshots, restoreSnapshot } from '@shared/snapshots'
import type { BibleKind, EngineId, SeriesConfig, EngineEvent, EngineSettings, ExportFormat, NovelConfig, PermissionMode, PermissionResponse, SceneMeta, SendOptions, SessionRecord } from '@shared/types'
import type { Engine } from './engines/engine'
import { ClaudeEngine } from './engines/claudeEngine'
import { CodexEngine } from './engines/codexEngine'
import { getAuthStatus, launchLogin } from './services/auth'
import { getCodexCatalog } from './services/codexRuntime'
import { deleteSession, expandCommand, listCommands, listReports, listSessions, loadSession, loadStats, recordWords, saveSession, streak } from './services/store'
import { exportManuscript } from './services/exporter'
import { ignoredByWatcher } from './services/watchfilter'
import { syncAi, syncStatus, type SyncDirection, type SyncEnv } from './services/aisync'
import { checkForUpdates, downloadUpdate, getUpdateStatus, installUpdate, setupUpdates } from './services/updater'
import { BrainstormStore, IDEAS_FILE, parseIdeas, transcriptMarkdown } from './services/brainstorm'

/** package.json version, baked in at build time (app.getVersion() is Electron's own in dev runs). */
declare const __APP_VERSION__: string

// ---------------- app settings (userData) ----------------

interface AppSettings {
  recent: string[]
  theme: 'dark' | 'light' | 'system'
  lastProject?: string
  editorFont: 'serif' | 'sans' | 'mono'
  editorWidth: number
  /** The version whose What's new pop-up the user has seen. */
  lastSeenVersion?: string
  /** Identifies this device in a book's .novel/ai manifest. */
  deviceId?: string
}
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
function getSettings(): AppSettings {
  const d: AppSettings = { recent: [], theme: 'system', editorFont: 'serif', editorWidth: 720 }
  try {
    return { ...d, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }
  } catch {
    return d
  }
}
function setSettings(patch: Partial<AppSettings>): AppSettings {
  const s = { ...getSettings(), ...patch }
  writeText(settingsFile(), JSON.stringify(s, null, 2))
  return s
}

// ---------------- state ----------------

let win: BrowserWindow | null = null
let root: string | null = null
let watcher: FSWatcher | null = null
let engine: Engine | null = null
/** Active brainstorm (chatting before any project exists). Mutually exclusive with root. */
let brainstorm: { id: string; dir: string } | null = null
let brainstorms: BrainstormStore

const send = (channel: string, payload?: unknown) => win?.webContents.send(channel, payload)
const requireRoot = () => {
  if (!root) throw new Error('No novel project is open')
  return root
}

// ---------------- AI memory and chats, kept in the book so they follow it between devices ----------------

function syncEnv(): SyncEnv {
  let { deviceId } = getSettings()
  if (!deviceId) deviceId = setSettings({ deviceId: crypto.randomUUID() }).deviceId!
  return {
    claudeHome: process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'),
    codexHome: process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
    stateFile: path.join(app.getPath('userData'), 'ai-sync-state.json'),
    deviceId,
    deviceName: os.hostname()
  }
}

/** Sync a book's AI memory and chats; tells the window when anything arrived from another device. */
function runSync(dir: string, direction: SyncDirection, manual = false) {
  try {
    const result = syncAi(dir, syncEnv(), direction)
    const loaded = result.loaded.chats + result.loaded.memory + result.loaded.removed
    if (manual || loaded > 0) send('aisync:result', { result, manual })
    return result
  } catch (e) {
    console.error('[aisync]', e)
    send('aisync:result', { error: (e as Error).message, manual })
    if (manual) throw e
    return null
  }
}

let saveTimer: NodeJS.Timeout | null = null
/** Save shortly after each AI reply (the engine has finished writing its transcript by then). */
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  const dir = root
  saveTimer = setTimeout(() => {
    if (dir && dir === root) runSync(dir, 'save')
  }, 3000)
}

let changeTimer: NodeJS.Timeout | null = null
function projectChanged() {
  if (changeTimer) clearTimeout(changeTimer)
  changeTimer = setTimeout(() => {
    if (!root) return
    const snap = loadProject(root)
    recordWords(root, snap.totalWords)
    send('project:changed', snap)
  }, 250)
}

async function openProject(dir: string) {
  if (!isNovelProject(dir)) throw new Error('That folder is not a Novel Coder project (no novel.json). Use "New Novel" instead.')
  engine?.close()
  engine = null
  if (root && path.resolve(root) !== path.resolve(dir)) runSync(root, 'save')
  await watcher?.close()
  root = dir
  brainstorm = null
  syncAgentInstructions(dir)
  // Bring in memory and chats saved on other devices before any chat resumes.
  runSync(dir, 'both')
  const seriesRoot = findSeriesRoot(dir)
  watcher = watch(seriesRoot ?? dir, {
    ignoreInitial: true,
    ignored: ignoredByWatcher,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
  })
  watcher.on('all', (_ev, file) => {
    const base = path.basename(file)
    if (base === 'NOVEL.md' || base === 'novel.json') syncAgentInstructions(path.dirname(file))
    if (seriesRoot && (base === 'SERIES.md' || base === 'series.json') && path.dirname(file) === seriesRoot)
      for (const b of listBooks(seriesRoot)) syncAgentInstructions(b.root)
    projectChanged()
  })
  const s = getSettings()
  setSettings({ lastProject: dir, recent: [dir, ...s.recent.filter((r) => r !== dir)].slice(0, 12) })
  win?.setTitle(`${loadConfig(dir).title}${seriesRoot ? ` · ${loadSeriesConfig(seriesRoot).title}` : ''} | Novel Coder`)
  const snap = loadProject(dir)
  recordWords(dir, snap.totalWords)
  if ((await listSnapshots(dir, 1)).length === 0) await createSnapshot(dir, 'Project opened').catch(() => null)
  return snap
}

// ---------------- IPC ----------------

function handle(channel: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(channel, async (_e, ...args) => fn(...(args as never[])))
}

function registerIpc() {
  // app
  handle('app:getSettings', () => getSettings())
  handle('app:setSettings', (p: Partial<AppSettings>) => setSettings(p))
  handle('app:pickFolder', async (title: string) => {
    const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('app:pickImages', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] })
    return r.canceled ? [] : r.filePaths
  })
  handle('app:saveTempImage', (name: string, data: ArrayBuffer) => {
    const f = path.join(app.getPath('temp'), 'novel-coder', `${Date.now()}-${name.replace(/[^\w.-]/g, '')}`)
    writeText(f, '')
    fs.writeFileSync(f, Buffer.from(data))
    return f
  })
  handle('app:openPath', (rel: string) => shell.openPath(rel && root && !path.isAbsolute(rel) ? resolveInside(root, rel) : rel))
  handle('app:showInFolder', (rel: string) => shell.showItemInFolder(root ? resolveInside(root, rel) : rel))
  handle('app:openExternal', (url: string) => (/^https?:\/\//.test(url) ? shell.openExternal(url) : undefined))
  handle('app:version', () => __APP_VERSION__)

  // updates (GitHub releases)
  handle('updates:status', () => getUpdateStatus())
  handle('updates:check', () => checkForUpdates())
  handle('updates:download', () => downloadUpdate())
  handle('updates:install', () =>
    installUpdate(() => {
      engine?.close()
      engine = null
    })
  )

  // project
  handle('project:open', (dir: string) => openProject(dir))
  handle('project:create', async (dir: string, opts: CreateOptions) => openProject(createProject(dir, opts)))
  handle('project:current', () => (root ? loadProject(root) : null))
  handle('project:shelf', () => getSettings().recent.map(shelfBook))
  handle('project:readManuscript', (chapter?: string) => readManuscript(requireRoot(), chapter))
  handle('project:close', async () => {
    engine?.close()
    engine = null
    if (root) runSync(root, 'save')
    await watcher?.close()
    root = null
    brainstorm = null
    setSettings({ lastProject: undefined })
  })

  // series
  handle('series:addBook', async (title: string) => {
    const sr = findSeriesRoot(requireRoot())
    if (!sr) throw new Error('This book is not part of a series.')
    return openProject(addBookToSeries(sr, title))
  })
  handle('series:openBook', (bookRoot: string) => {
    const sr = findSeriesRoot(requireRoot())
    if (!sr || path.dirname(path.resolve(bookRoot)) !== sr) throw new Error('Not a book of this series')
    return openProject(bookRoot)
  })
  handle('series:saveConfig', (cfg: SeriesConfig) => {
    const sr = findSeriesRoot(requireRoot())
    if (!sr) throw new Error('This book is not part of a series.')
    saveSeriesConfig(sr, cfg)
    projectChanged()
  })
  handle('series:convert', async (seriesTitle: string, plannedBooks: number) => {
    const r = requireRoot()
    await createSnapshot(r, 'Before turning into a series').catch(() => null)
    engine?.close()
    engine = null
    await watcher?.close()
    watcher = null
    const dest = convertToSeries(r, seriesTitle, plannedBooks)
    const st = getSettings()
    setSettings({ recent: st.recent.filter((x) => path.resolve(x) !== path.resolve(r)) })
    return openProject(dest)
  })

  // brainstorms (chat before a project exists)
  const leaveCurrent = async () => {
    engine?.close()
    engine = null
    await watcher?.close()
    watcher = null
    root = null
  }
  handle('brainstorm:list', () => brainstorms.list())
  handle('brainstorm:create', async (engineId: EngineId) => {
    await leaveCurrent()
    const { meta, dir } = brainstorms.create(engineId)
    await startBrainstorm(meta.id, dir)
    return brainstorms.load(meta.id)
  })
  handle('brainstorm:open', async (id: string) => {
    const b = brainstorms.load(id)
    if (!b) throw new Error('Brainstorm not found')
    await leaveCurrent()
    await startBrainstorm(id, b.dir)
    return b
  })
  handle('brainstorm:close', async () => {
    await leaveCurrent()
    brainstorm = null
    win?.setTitle('Novel Coder')
  })
  handle('brainstorm:saveSession', (id: string, sess: SessionRecord) => brainstorms.saveSession(id, sess))
  handle('brainstorm:delete', (id: string) => {
    if (brainstorm?.id === id) brainstorm = null
    brainstorms.delete(id)
  })
  handle('brainstorm:ideas', (id: string) => {
    const b = brainstorms.load(id)
    return b ? { text: b.ideas, fields: parseIdeas(b.ideas) } : null
  })
  handle('brainstorm:writeIdeas', (id: string, text: string) => writeText(path.join(brainstorms.dir(id), IDEAS_FILE), text))
  handle('brainstorm:convert', async (id: string, dir: string, opts: CreateOptions) => {
    const b = brainstorms.load(id)
    if (!b) throw new Error('Brainstorm not found')
    engine?.close()
    engine = null
    const bookRoot = createProject(dir, opts)
    writeText(path.join(bookRoot, 'notes', 'brainstorm-ideas.md'), b.ideas)
    writeText(path.join(bookRoot, 'notes', 'brainstorm-conversation.md'), transcriptMarkdown(b.session))
    const snap = await openProject(bookRoot)
    return { project: snap, session: b.session }
  })
  handle('project:readFile', (rel: string) => readText(resolveInside(requireRoot(), rel)))
  handle('project:writeFile', (rel: string, text: string) => writeText(resolveInside(requireRoot(), rel), text))
  handle('project:deleteFile', (rel: string) => {
    const abs = resolveInside(requireRoot(), rel)
    fs.rmSync(abs, { recursive: true, force: true })
  })
  handle('project:renameFile', (rel: string, newRel: string) => {
    const r = requireRoot()
    const to = resolveInside(r, newRel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.renameSync(resolveInside(r, rel), to)
  })
  handle('project:readDoc', (rel: string) => {
    const text = readText(resolveInside(requireRoot(), rel))
    try {
      const m = matter(text)
      return { data: m.data, body: m.content.replace(/^\n+/, ''), hasFrontmatter: text.startsWith('---') }
    } catch {
      return { data: {}, body: text, hasFrontmatter: false }
    }
  })
  handle('project:writeDoc', (rel: string, data: Record<string, unknown>, body: string) => {
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
    writeText(resolveInside(requireRoot(), rel), Object.keys(clean).length ? matter.stringify('\n' + body.trim() + '\n', clean) : body)
  })
  handle('project:readScene',(rel: string) => readScene(requireRoot(), rel))
  handle('project:writeScene', (rel: string, meta: Partial<SceneMeta>, body: string) => writeScene(requireRoot(), rel, meta, body))
  handle('project:createChapter', (title: string) => {
    const r = requireRoot()
    const folder = createChapter(r, title)
    return createScene(r, folder, 'Scene 1')
  })
  handle('project:createScene', (chapter: string, title: string) => createScene(requireRoot(), chapter, title))
  handle('project:renameChapter', (folder: string, title: string) => {
    writeText(resolveInside(requireRoot(), `manuscript/${folder}/_chapter.md`), `---\ntitle: ${JSON.stringify(title)}\n---\n`)
  })
  handle('project:reorderScenes', (chapter: string, ordered: string[]) => reorderScenes(requireRoot(), chapter, ordered))
  handle('project:moveScene', (rel: string, toChapter: string) => {
    const r = requireRoot()
    const dir = resolveInside(r, `manuscript/${toChapter}`)
    const names = fs.readdirSync(dir).filter((n) => n !== '_chapter.md')
    const dest = `manuscript/${toChapter}/${nextNumber(names)}-${path.basename(rel).replace(/^\d+[-_ ]*/, '')}`
    fs.renameSync(resolveInside(r, rel), resolveInside(r, dest))
    return dest
  })
  handle('project:saveConfig', (cfg: NovelConfig) => {
    saveConfig(requireRoot(), cfg)
    win?.setTitle(`${cfg.title} | Novel Coder`)
  })
  handle('bible:upsert', (kind: BibleKind, name: string, fields: Record<string, unknown>, body: string, scope?: 'book' | 'series') =>
    upsertBibleEntry(requireRoot(), kind, name, fields, body, 'replace', scope)
  )

  // stats, snapshots, reports, export
  handle('stats:get', () => {
    const r = requireRoot()
    const stats = loadStats(r)
    return { stats, streak: streak(stats, loadConfig(r).dailyGoal) }
  })
  handle('snapshots:list', () => listSnapshots(requireRoot()))
  handle('snapshots:create', (msg: string) => createSnapshot(requireRoot(), msg || 'Manual snapshot'))
  handle('snapshots:restore', async (oid: string) => {
    await restoreSnapshot(requireRoot(), oid)
    projectChanged()
  })
  handle('reports:list', () => listReports(requireRoot()))
  handle('export:run', async (format: ExportFormat, askPath: boolean) => {
    const r = requireRoot()
    let out: string | undefined
    if (askPath) {
      const res = await dialog.showSaveDialog(win!, {
        defaultPath: path.join(r, 'exports', `${loadConfig(r).title}.${format}`),
        filters: [{ name: format.toUpperCase(), extensions: [format] }]
      })
      if (res.canceled || !res.filePath) return null
      out = res.filePath
    }
    return exportManuscript(r, format, out, renderPdf)
  })

  // sessions + commands + auth
  handle('sessions:list', () => (root ? listSessions(root) : []))
  handle('sessions:load', (id: string) => loadSession(requireRoot(), id))
  handle('sessions:save', (s: SessionRecord) => saveSession(requireRoot(), s))
  handle('sessions:delete', (id: string) => deleteSession(requireRoot(), id))
  handle('commands:list', () => listCommands(root))
  handle('commands:expand', (name: string, args: string) => expandCommand(root, name, args))
  // AI memory and chats across devices
  handle('aisync:status', () => (root ? syncStatus(root, syncEnv()) : null))
  handle('aisync:save', () => runSync(requireRoot(), 'save', true))
  handle('aisync:load', () => runSync(requireRoot(), 'load', true))

  handle('auth:status', () => getAuthStatus())
  handle('auth:login', (e: 'claude' | 'codex') => launchLogin(e))

  // engine
  handle('engine:codexModels', () => getCodexCatalog(root ?? brainstorm?.dir))
  handle('engine:start', (settings: EngineSettings, resumeSessionId?: string) => {
    const cwd = root ?? brainstorm?.dir
    if (!cwd) throw new Error('Open a novel or start a brainstorm first')
    engine?.close()
    const emit = (ev: EngineEvent) => {
      send('engine:event', { engine: settings.engine, ev })
      if (ev.type === 'done' && root) scheduleSave()
    }
    const seriesRoot = root ? findSeriesRoot(root) : null
    const opts = {
      root: cwd,
      settings,
      resumeSessionId,
      emit,
      mode: (root ? 'novel' : 'brainstorm') as 'novel' | 'brainstorm',
      extraDirs: seriesRoot ? [seriesRoot] : undefined
    }
    try {
      engine = settings.engine === 'claude' ? new ClaudeEngine(opts) : new CodexEngine(opts)
    } catch (e) {
      engine = null
      throw e
    }
  })
  handle('engine:send', (msg: SendOptions) => {
    if (!engine) throw new Error('Engine not started')
    void engine.send(msg).catch((e) => send('engine:event', { engine: engine?.id, ev: { type: 'error', message: String(e?.message ?? e) } }))
  })
  handle('engine:interrupt', () => engine?.interrupt())
  handle('engine:setMode', (m: PermissionMode) => engine?.setPermissionMode(m))
  handle('engine:setModel', (m: string) => engine?.setModel(m))
  handle('engine:setEffort', (e: string) => engine?.setEffort?.(e))
  handle('engine:respond', (r: PermissionResponse) => engine?.respondPermission(r))
  handle('engine:close', () => {
    engine?.close()
    engine = null
  })
}

type CreateOptions = ScaffoldOptions & { kind?: 'novel' | 'series'; seriesTitle?: string; plannedBooks?: number; description?: string }

/** Create a standalone novel or a series; returns the root of the book to open. */
function createProject(dir: string, opts: CreateOptions): string {
  const clean = (t: string, d: string) => t.replace(/[<>:"/\\|?*]+/g, '').trim() || d
  if (opts.kind === 'series') {
    const seriesTitle = opts.seriesTitle || opts.title
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) dir = path.join(dir, clean(seriesTitle, 'My Series'))
    const o: SeriesScaffoldOptions = { ...opts, seriesTitle, firstBookTitle: opts.title, plannedBooks: opts.plannedBooks, description: opts.description }
    return scaffoldSeries(dir, o)
  }
  if (fs.existsSync(dir) && fs.readdirSync(dir).length && !isNovelProject(dir)) dir = path.join(dir, clean(opts.title, 'My Novel'))
  scaffoldProject(dir, opts)
  return dir
}

async function startBrainstorm(id: string, dir: string) {
  brainstorm = { id, dir }
  win?.setTitle('Brainstorm | Novel Coder')
  watcher = watch(path.join(dir, IDEAS_FILE), { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } })
  watcher.on('all', () => {
    if (brainstorm?.id !== id) return
    const text = readText(path.join(dir, IDEAS_FILE))
    send('brainstorm:changed', { id, text, fields: parseIdeas(text) })
  })
}

function reorderScenes(r: string, chapter: string, ordered: string[]) {
  const tmp = ordered.map((rel, i) => {
    const t = `${rel}.reorder-${i}`
    fs.renameSync(resolveInside(r, rel), resolveInside(r, t))
    return { t, base: path.basename(rel).replace(/^\d+[-_ ]*/, '') }
  })
  tmp.forEach(({ t, base }, i) => fs.renameSync(resolveInside(r, t), resolveInside(r, `manuscript/${chapter}/${String(i + 1).padStart(2, '0')}-${base}`)))
  return listChapters(r)
}

async function renderPdf(html: string): Promise<Buffer> {
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  try {
    const f = path.join(app.getPath('temp'), `novel-coder-${Date.now()}.html`)
    fs.writeFileSync(f, html, 'utf8')
    await w.loadFile(f)
    const buf = await w.webContents.printToPDF({ pageSize: 'Letter', printBackground: false })
    fs.rmSync(f, { force: true })
    return buf
  } finally {
    w.destroy()
  }
}

// ---------------- window ----------------

/** The window's size, position and maximized state, saved on close so the app reopens the way it was left. */
interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}
const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json')
function loadWindowState(): WindowState {
  const d: WindowState = { width: 1500, height: 940, maximized: false }
  try {
    const s = { ...d, ...JSON.parse(fs.readFileSync(windowStateFile(), 'utf8')) } as WindowState
    s.width = Math.max(980, Math.round(s.width) || d.width)
    s.height = Math.max(600, Math.round(s.height) || d.height)
    // Only reuse the position if the window would still be visible (a monitor may have been unplugged).
    if (s.x !== undefined && s.y !== undefined) {
      const onScreen = screen.getAllDisplays().some(({ workArea: a }) => s.x! < a.x + a.width - 100 && s.x! + s.width > a.x + 100 && s.y! >= a.y - 10 && s.y! < a.y + a.height - 100)
      if (!onScreen) delete s.x, delete s.y
    }
    return s
  } catch {
    return d
  }
}
function saveWindowState(w: BrowserWindow) {
  try {
    // The size it returns to when un-maximized, so restoring still works after reopening maximized.
    const b = w.getNormalBounds()
    writeText(windowStateFile(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: w.isMaximized() } satisfies WindowState))
  } catch {
    /* not critical */
  }
}

function createWindow() {
  const state = loadWindowState()
  win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: false,
    minWidth: 980,
    minHeight: 600,
    title: 'Novel Coder',
    backgroundColor: '#0c0e13',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#9ba1ae', height: 40 },
    icon: path.join(import.meta.dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      spellcheck: true
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Spellcheck suggestions in the right-click menu (useful for prose).
  win.webContents.on('context-menu', (_e, params) => {
    const items: Electron.MenuItemConstructorOptions[] = params.dictionarySuggestions.map((s) => ({
      label: s,
      click: () => win?.webContents.replaceMisspelling(s)
    }))
    if (params.misspelledWord) {
      items.push({ label: 'Add to dictionary', click: () => win?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) })
      items.push({ type: 'separator' })
    }
    items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' })
    Menu.buildFromTemplate(items).popup()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  const w = win
  w.once('ready-to-show', () => {
    if (state.maximized) w.maximize()
    w.show()
  })
  w.on('close', () => saveWindowState(w))
  win.on('closed', () => {
    win = null
  })
}

// Isolated profile for automated tests.
if (process.env.NOVEL_CODER_USER_DATA) app.setPath('userData', process.env.NOVEL_CODER_USER_DATA)

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  // Open a project passed on the command line (e.g. a folder or a double-clicked novel.json).
  const arg = process.argv.slice(1).find((a) => !a.startsWith('-') && a !== '.' && !a.endsWith('.js') && fs.existsSync(a))
  if (arg) {
    const d = fs.statSync(arg).isDirectory() ? arg : path.dirname(arg)
    if (isNovelProject(d)) setSettings({ lastProject: path.resolve(d) })
  }
  brainstorms = new BrainstormStore(path.join(app.getPath('userData'), 'brainstorms'))
  registerIpc()
  createWindow()
  if (win) setupUpdates(win)
})

app.on('window-all-closed', () => {
  engine?.close()
  if (root) runSync(root, 'save')
  void watcher?.close()
  app.quit()
})
