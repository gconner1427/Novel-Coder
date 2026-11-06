// Per-project persistent data under .novel/: word-count stats, chat sessions, custom commands, reports.
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { readText, writeText } from '@shared/project'
import type { SessionRecord, SessionSummary, SlashCommand, StatsFile } from '@shared/types'
import { BUILTIN_COMMANDS, expandPrompt } from '../engines/prompts'

const dir = (root: string, ...p: string[]) => path.join(root, '.novel', ...p)

// ---------------- stats ----------------

export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function loadStats(root: string): StatsFile {
  try {
    return JSON.parse(readText(dir(root, 'stats.json'))) as StatsFile
  } catch {
    return { days: [] }
  }
}

/** Record the current manuscript total. Words written today = end - start for today's entry. */
export function recordWords(root: string, total: number): StatsFile {
  const stats = loadStats(root)
  const t = today()
  let day = stats.days.find((d) => d.date === t)
  if (!day) {
    const prev = stats.days[stats.days.length - 1]
    day = { date: t, startWords: prev ? prev.endWords : total, endWords: total }
    stats.days.push(day)
  }
  if (day.endWords !== total) {
    day.endWords = total
  }
  stats.days = stats.days.slice(-400)
  // Only write when something changed. (Writing on every call fed a reload loop: the file watcher saw
  // the write, reloaded the book, which recorded words again, and so on, several times a second.)
  const text = JSON.stringify(stats, null, 2)
  if (readText(dir(root, 'stats.json')) !== text) writeText(dir(root, 'stats.json'), text)
  return stats
}

export function streak(stats: StatsFile, goal: number): number {
  let n = 0
  const days = [...stats.days].reverse()
  for (let i = 0; i < days.length; i++) {
    const written = days[i].endWords - days[i].startWords
    if (written >= goal) n++
    else if (i === 0) continue // today not done yet doesn't break the streak
    else break
  }
  return n
}

// ---------------- sessions ----------------

export function listSessions(root: string): SessionSummary[] {
  const d = dir(root, 'sessions')
  if (!fs.existsSync(d)) return []
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) as SessionRecord
        return { id: s.id, title: s.title, updated: s.updated, engine: s.engine }
      } catch {
        return null
      }
    })
    .filter((x): x is SessionSummary => !!x)
    .sort((a, b) => b.updated - a.updated)
}

export function loadSession(root: string, id: string): SessionRecord | null {
  try {
    return JSON.parse(readText(dir(root, 'sessions', `${id.replace(/[^\w-]/g, '')}.json`))) as SessionRecord
  } catch {
    return null
  }
}

export function saveSession(root: string, s: SessionRecord): void {
  writeText(dir(root, 'sessions', `${s.id.replace(/[^\w-]/g, '')}.json`), JSON.stringify(s))
}

export function deleteSession(root: string, id: string): void {
  fs.rmSync(dir(root, 'sessions', `${id.replace(/[^\w-]/g, '')}.json`), { force: true })
}

// ---------------- slash commands ----------------

function projectCommands(root: string): Record<string, { description: string; args?: string; prompt: string }> {
  const d = dir(root, 'commands')
  const out: Record<string, { description: string; args?: string; prompt: string }> = {}
  if (!fs.existsSync(d)) return out
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.md')) continue
    try {
      const m = matter(fs.readFileSync(path.join(d, f), 'utf8'))
      out[path.basename(f, '.md')] = { description: String(m.data.description ?? 'Custom command'), args: m.data.args, prompt: m.content.trim() }
    } catch {
      /* ignore */
    }
  }
  return out
}

export function listCommands(root: string | null): SlashCommand[] {
  const builtins: SlashCommand[] = Object.entries(BUILTIN_COMMANDS).map(([name, c]) => ({
    name,
    description: c.description,
    args: c.args,
    kind: c.local ? 'local' : 'prompt',
    source: 'builtin'
  }))
  if (!root) return builtins
  const custom: SlashCommand[] = Object.entries(projectCommands(root)).map(([name, c]) => ({
    name,
    description: c.description,
    args: c.args,
    kind: 'prompt',
    source: 'project'
  }))
  return [...builtins, ...custom]
}

/** Expand a prompt-type slash command into the text sent to the engine. */
export function expandCommand(root: string | null, name: string, args: string): string | null {
  const custom = root ? projectCommands(root)[name] : undefined
  if (custom) return expandPrompt(custom.prompt, args)
  const b = BUILTIN_COMMANDS[name]
  if (b?.prompt) return expandPrompt(b.prompt, args)
  return null
}

// ---------------- reports ----------------

export function listReports(root: string): { path: string; name: string; mtime: number }[] {
  const d = dir(root, 'reports')
  if (!fs.existsSync(d)) return []
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ path: `.novel/reports/${f}`, name: f.replace(/\.md$/, ''), mtime: fs.statSync(path.join(d, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
}
