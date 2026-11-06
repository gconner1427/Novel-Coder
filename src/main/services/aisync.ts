// Keeps a book's AI memory and chat transcripts in its project folder (.novel/ai), so they follow the
// book between devices through the user's cloud storage.
//
//   .novel/ai/memory/            Claude Code's memory notes for this book (Codex reads and adds to them too)
//   .novel/ai/chats/claude/      Claude Code session transcripts (<id>.jsonl and <id>/ side files)
//   .novel/ai/chats/codex/       Codex thread rollouts (same relative path as under ~/.codex/sessions)
//   .novel/ai/manifest.json      which device saved each file, and the book's path on that device
//
// Memory is synced three ways (local, folder, and what this device saw at its last sync), so an edit or a
// deletion on either device wins over an unchanged copy. Transcripts only ever grow, so the longer copy wins.
// When a transcript moves to a device where the book lives at a different path, paths inside it are rewritten.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export interface SyncEnv {
  /** ~/.claude (or CLAUDE_CONFIG_DIR) */
  claudeHome: string
  /** ~/.codex (or CODEX_HOME) */
  codexHome: string
  /** Per-device record of what was last synced, per book. */
  stateFile: string
  deviceId: string
  deviceName: string
}

export type SyncDirection = 'save' | 'load' | 'both'

export interface SyncResult {
  direction: SyncDirection
  saved: { chats: number; memory: number }
  loaded: { chats: number; memory: number; removed: number }
  /** Devices whose files were loaded here. */
  fromDevices: string[]
  at: number
}

interface FileInfo {
  device: string
  deviceName: string
  /** The book's folder on the device that saved this file (for path rewriting). */
  root: string
  size: number
  mtime: number
}

interface Manifest {
  schema: 1
  devices: Record<string, { name: string; lastSave: number }>
  files: Record<string, FileInfo>
}

interface DeviceState {
  books: Record<string, { memory: Record<string, string>; lastSave?: number; lastLoad?: number; lastLoadFrom?: string[] }>
}

export const AI_DIR = path.join('.novel', 'ai')

/** Claude Code's folder name for a working directory: every non-alphanumeric character becomes "-". */
export function claudeProjectKey(root: string): string {
  return path.resolve(root).replace(/[^a-zA-Z0-9]/g, '-')
}

const sha = (file: string) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')
const exists = (p: string) => fs.existsSync(p)
const toPosix = (p: string) => p.split(path.sep).join('/')

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}

/** All files under dir, as posix paths relative to dir. */
function walk(dir: string, rel = ''): string[] {
  const out: string[] = []
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...walk(dir, r))
    else if (e.isFile()) out.push(r)
  }
  return out
}

function copy(from: string, to: string, mtime?: number) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  if (mtime) fs.utimesSync(to, new Date(), new Date(mtime))
}

/** Escaped forms a path can take inside a JSON transcript. */
function pathForms(p: string): string[] {
  const abs = path.resolve(p)
  const variants = new Set([abs, abs.charAt(0).toLowerCase() + abs.slice(1), abs.charAt(0).toUpperCase() + abs.slice(1)])
  const out: string[] = []
  for (const v of variants) {
    out.push(JSON.stringify(v).slice(1, -1)) // C:\\Users\\...
    out.push(v.split(path.sep).join('/')) // C:/Users/...
  }
  return out
}

/** Copy a transcript, rewriting the book's old path to its path on this device. */
function copyTranscript(from: string, to: string, oldRoot: string, newRoot: string) {
  if (!oldRoot || path.resolve(oldRoot).toLowerCase() === path.resolve(newRoot).toLowerCase() || !/\.jsonl?$/i.test(from)) return copy(from, to)
  let text = fs.readFileSync(from, 'utf8')
  const olds = pathForms(oldRoot)
  const news = pathForms(newRoot)
  olds.forEach((o, i) => {
    text = text.split(o).join(news[i % 2 === 0 ? 0 : 1])
  })
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.writeFileSync(to, text)
}

/** The Codex thread ids this book's chats use (from .novel/sessions). */
function codexThreadIds(root: string): Set<string> {
  const ids = new Set<string>()
  const dir = path.join(root, '.novel', 'sessions')
  for (const f of walk(dir)) {
    if (!f.endsWith('.json')) continue
    const s = readJson<{ engineSessions?: { codex?: string } }>(path.join(dir, f), {})
    if (s.engineSessions?.codex) ids.add(s.engineSessions.codex)
  }
  return ids
}

export function syncAi(root: string, env: SyncEnv, direction: SyncDirection = 'both'): SyncResult {
  root = path.resolve(root)
  const save = direction !== 'load'
  const load = direction !== 'save'
  const ai = path.join(root, AI_DIR)
  const manifestFile = path.join(ai, 'manifest.json')
  const manifest = readJson<Manifest>(manifestFile, { schema: 1, devices: {}, files: {} })
  const state = readJson<DeviceState>(env.stateFile, { books: {} })
  const book = (state.books[root] ??= { memory: {} })
  const result: SyncResult = { direction, saved: { chats: 0, memory: 0 }, loaded: { chats: 0, memory: 0, removed: 0 }, fromDevices: [], at: Date.now() }
  const from = new Set<string>()
  const record = (rel: string, file: string) => {
    const st = fs.statSync(file)
    manifest.files[rel] = { device: env.deviceId, deviceName: env.deviceName, root, size: st.size, mtime: st.mtimeMs }
  }
  const loadedFrom = (rel: string) => {
    const info = manifest.files[rel]
    if (info && info.device !== env.deviceId) from.add(info.deviceName)
  }

  // ---- memory: three-way ----
  const localMem = path.join(env.claudeHome, 'projects', claudeProjectKey(root), 'memory')
  const folderMem = path.join(ai, 'memory')
  const names = new Set([...walk(localMem), ...walk(folderMem)])
  const nextMemState: Record<string, string> = {}
  for (const name of names) {
    const L = path.join(localMem, name)
    const B = path.join(folderMem, name)
    const rel = `memory/${name}`
    const hasL = exists(L)
    const hasB = exists(B)
    const last = book.memory[name]
    if (hasL && hasB) {
      const hl = sha(L)
      const hb = sha(B)
      if (hl === hb) nextMemState[name] = hl
      else if (hl === last || (hb !== last && fs.statSync(B).mtimeMs > fs.statSync(L).mtimeMs)) {
        // The folder copy changed (or both did and it is newer): take it.
        if (load) {
          copy(B, L)
          loadedFrom(rel)
          result.loaded.memory++
          nextMemState[name] = hb
        } else nextMemState[name] = last ?? hl
      } else {
        if (save) {
          copy(L, B)
          record(rel, B)
          result.saved.memory++
          nextMemState[name] = hl
        } else nextMemState[name] = last ?? hb
      }
    } else if (hasL) {
      if (last !== undefined) {
        // It was in the folder at the last sync and is gone now: deleted on another device.
        if (load) {
          fs.rmSync(L, { force: true })
          result.loaded.removed++
        } else nextMemState[name] = last
      } else if (save) {
        copy(L, B)
        record(rel, B)
        result.saved.memory++
        nextMemState[name] = sha(L)
      }
    } else if (hasB) {
      if (last !== undefined) {
        // Deleted on this device since the last sync.
        if (save) {
          fs.rmSync(B, { force: true })
          delete manifest.files[rel]
          result.saved.memory++
        } else nextMemState[name] = last
      } else if (load) {
        copy(B, L)
        loadedFrom(rel)
        result.loaded.memory++
        nextMemState[name] = sha(B)
      }
    }
  }
  book.memory = nextMemState

  // ---- transcripts: the longer copy wins ----
  // Measured in lines for .jsonl transcripts: rewriting the book's path changes a transcript's size in
  // bytes but not how many entries it has, so bytes would make copies look different forever.
  const length = (file: string) => {
    if (!exists(file)) return -1
    if (!/\.jsonl$/i.test(file)) return fs.statSync(file).size
    const buf = fs.readFileSync(file)
    let n = 0
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++
    return buf.length && buf[buf.length - 1] !== 10 ? n + 1 : n
  }
  const syncTranscript = (local: string, folderRel: string, isChat: boolean) => {
    const B = path.join(ai, folderRel)
    const sizeL = length(local)
    const sizeB = length(B)
    if (sizeL > sizeB && save) {
      copy(local, B)
      record(folderRel, B)
      if (isChat) result.saved.chats++
    } else if (sizeB > sizeL && load) {
      const info = manifest.files[folderRel]
      copyTranscript(B, local, info?.root ?? root, root)
      loadedFrom(folderRel)
      if (isChat) result.loaded.chats++
    }
  }

  // Claude Code: every session for this book's folder, plus each session's side files.
  const claudeDir = path.join(env.claudeHome, 'projects', claudeProjectKey(root))
  const claudeFiles = new Set<string>()
  for (const f of walk(claudeDir)) if (!f.startsWith('memory/')) claudeFiles.add(f)
  for (const f of walk(path.join(ai, 'chats', 'claude'))) claudeFiles.add(f)
  for (const f of claudeFiles) syncTranscript(path.join(claudeDir, f), `chats/claude/${f}`, /^[^/]+\.jsonl$/.test(f))

  // Codex: the threads this book's chats use, found under ~/.codex/sessions by id.
  const codexSessions = path.join(env.codexHome, 'sessions')
  const ids = codexThreadIds(root)
  if (ids.size) {
    const localByRel = new Map<string, string>()
    for (const f of walk(codexSessions)) for (const id of ids) if (f.includes(id)) localByRel.set(f, path.join(codexSessions, f))
    for (const f of walk(path.join(ai, 'chats', 'codex'))) localByRel.set(f, path.join(codexSessions, f))
    for (const [rel, local] of localByRel) syncTranscript(local, `chats/codex/${rel}`, true)
  }

  if (save) {
    manifest.devices[env.deviceId] = { name: env.deviceName, lastSave: result.at }
    book.lastSave = result.at
  }
  if (load) {
    book.lastLoad = result.at
    if (from.size) book.lastLoadFrom = [...from]
  }
  result.fromDevices = [...from]
  if (save || exists(manifestFile)) writeJson(manifestFile, manifest)
  writeJson(env.stateFile, state)
  return result
}

/** What the Settings panel shows. */
export function syncStatus(root: string, env: SyncEnv) {
  root = path.resolve(root)
  const manifest = readJson<Manifest>(path.join(root, AI_DIR, 'manifest.json'), { schema: 1, devices: {}, files: {} })
  const book = readJson<DeviceState>(env.stateFile, { books: {} }).books[root]
  const files = Object.keys(manifest.files)
  return {
    thisDevice: env.deviceName,
    lastSave: book?.lastSave,
    lastLoad: book?.lastLoad,
    lastLoadFrom: book?.lastLoadFrom ?? [],
    devices: Object.entries(manifest.devices).map(([id, d]) => ({ name: d.name, lastSave: d.lastSave, thisDevice: id === env.deviceId })),
    chats: files.filter((f) => /^chats\/(claude\/[^/]+\.jsonl|codex\/.+\.jsonl)$/.test(f)).length,
    memoryNotes: files.filter((f) => f.startsWith('memory/')).length,
    memoryDir: toPosix(path.join(AI_DIR, 'memory'))
  }
}
