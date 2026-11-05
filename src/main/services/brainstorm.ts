// Brainstorm workspaces: talk an idea through with Claude or Codex before any book exists.
// Each brainstorm is a small folder (in the app's user data) holding the conversation, an
// ideas.md the AI keeps up to date, and CLAUDE.md/AGENTS.md telling the engines what to do.
import fs from 'node:fs'
import path from 'node:path'
import { readText, writeText } from '@shared/project'
import type { BrainstormSummary, EngineId, IdeaFields, SessionRecord } from '@shared/types'

export const IDEAS_FILE = 'ideas.md'

export const IDEAS_TEMPLATE = `# Book idea

<!-- Novel Coder reads these fields when you turn this brainstorm into a project. Keep them current. -->
- Working title:
- Format: standalone novel
- Genre:
- Point of view:
- Tense:
- Premise:

## Characters

## Setting & world

## Plot ideas

## Themes & tone

## Open questions
`

const INSTRUCTIONS = `# Brainstorming a new book with Novel Coder

You are brainstorming a **new novel or novel series** with an author who has not created the project yet.
There is no manuscript and no story bible yet. This folder is a scratch workspace.

Your role: an enthusiastic but honest creative partner and story developer.
- Ask focused questions, one or two at a time. Don't interrogate.
- Offer distinct, specific options (premises, hooks, characters, settings, twists, titles) with the trade-offs of each.
- Build on what the author likes; gently flag clichés and structural problems; suggest comparable titles.
- Help decide whether the idea is a **standalone novel or a series**. If it's a series, sketch how many books and what each book's core conflict is.
- Short sample paragraphs to test a voice are welcome. Don't write whole chapters unless asked.

Keep \`ideas.md\` in this folder up to date as decisions are made (edit the file directly). Always keep the
fields at the top accurate, because Novel Coder reads them to create the project:
\`Working title\`, \`Format\` ("standalone novel" or "series of N books"), \`Genre\`, \`Point of view\`, \`Tense\`, \`Premise\`.
Record characters, setting, plot ideas, themes and open questions in the sections below them.

When the idea feels solid, tell the author they can click **Turn into a book** (top right) to create the
Novel Coder project. The whole conversation and ideas.md carry over.
`

export interface BrainstormMeta {
  id: string
  title: string
  created: number
  updated: number
  engine: EngineId
}

export class BrainstormStore {
  constructor(private base: string) {}

  dir(id: string): string {
    return path.join(this.base, id.replace(/[^\w-]/g, ''))
  }

  create(engine: EngineId): { meta: BrainstormMeta; dir: string } {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const dir = this.dir(id)
    const meta: BrainstormMeta = { id, title: 'New brainstorm', created: Date.now(), updated: Date.now(), engine }
    writeText(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
    writeText(path.join(dir, IDEAS_FILE), IDEAS_TEMPLATE)
    writeText(path.join(dir, 'CLAUDE.md'), INSTRUCTIONS)
    writeText(path.join(dir, 'AGENTS.md'), INSTRUCTIONS)
    return { meta, dir }
  }

  list(): BrainstormSummary[] {
    if (!fs.existsSync(this.base)) return []
    return fs
      .readdirSync(this.base)
      .map((id) => {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(this.base, id, 'meta.json'), 'utf8')) as BrainstormMeta
          return { id: m.id, title: m.title, updated: m.updated, engine: m.engine, dir: this.dir(m.id) }
        } catch {
          return null
        }
      })
      .filter((x): x is BrainstormSummary => !!x)
      .sort((a, b) => b.updated - a.updated)
  }

  load(id: string): { meta: BrainstormMeta; session: SessionRecord | null; ideas: string; dir: string } | null {
    const dir = this.dir(id)
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as BrainstormMeta
      let session: SessionRecord | null = null
      try {
        session = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'))
      } catch {
        /* no conversation yet */
      }
      return { meta, session, ideas: readText(path.join(dir, IDEAS_FILE)), dir }
    } catch {
      return null
    }
  }

  saveSession(id: string, s: SessionRecord): void {
    const dir = this.dir(id)
    if (!fs.existsSync(dir)) return
    writeText(path.join(dir, 'session.json'), JSON.stringify(s))
    const prev = this.load(id)?.meta
    const fields = parseIdeas(readText(path.join(dir, IDEAS_FILE)))
    const meta: BrainstormMeta = {
      id,
      created: prev?.created ?? Date.now(),
      updated: Date.now(),
      engine: s.engine,
      title: fields.title || (s.title !== 'New conversation' ? s.title : prev?.title) || 'New brainstorm'
    }
    writeText(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
  }

  delete(id: string): void {
    fs.rmSync(this.dir(id), { recursive: true, force: true })
  }
}

/** Read the structured fields at the top of ideas.md. */
export function parseIdeas(text: string): IdeaFields {
  const field = (label: string) => {
    const m = new RegExp(`^[ \\t]*[-*][ \\t]*\\**${label}\\**[ \\t]*:[ \\t]*(.*)$`, 'im').exec(text)
    const v = m?.[1]?.replace(/\*\*/g, '').trim()
    return v && !/^(tbd|\?|-|none)$/i.test(v) ? v : undefined
  }
  const format = field('Format') ?? ''
  const series = /series|trilogy|duology|saga|books/i.test(format)
  const n = /(\d+)/.exec(format)?.[1] ?? (/trilogy/i.test(format) ? '3' : /duology/i.test(format) ? '2' : undefined)
  return {
    title: field('Working title') ?? field('Title'),
    genre: field('Genre'),
    pov: field('Point of view') ?? field('POV'),
    tense: field('Tense'),
    premise: field('Premise'),
    series,
    plannedBooks: series ? Number(n) || 3 : undefined
  }
}

/** Render a conversation as readable markdown (saved into the new project's notes/). */
export function transcriptMarkdown(s: SessionRecord | null): string {
  if (!s) return '# Brainstorm conversation\n\n(no messages)\n'
  const out = [`# Brainstorm conversation`, '']
  for (const it of s.items) {
    if (it.kind === 'user') out.push(`**Author:** ${it.text}`, '')
    else if (it.kind === 'assistant') out.push(`**${it.engine === 'claude' ? 'Claude' : 'Codex'}:** ${it.text}`, '')
  }
  return out.join('\n')
}
