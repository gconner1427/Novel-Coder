// Novel Coder MCP server (stdio). Spawned by both Claude Code and Codex so that either engine
// gets first-class tools for the story bible, manuscript, outline and continuity.
//   electron.exe out/main/mcp.js --project <root>     (with ELECTRON_RUN_AS_NODE=1)
import path from 'node:path'
import fs from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  BIBLE_KINDS,
  continuityContext,
  countWords,
  createChapter,
  createScene,
  findBibleEntry,
  listBible,
  listChapters,
  readScene,
  readText,
  resolveInside,
  searchBible,
  upsertBibleEntry,
  writeScene,
  writeText,
  loadConfig,
  saveConfig,
  loadSeries,
  listBooks,
  loadSeriesConfig,
  saveSeriesConfig
} from '../shared/project'
import { createSnapshot } from '../shared/snapshots'
import type { BibleKind, SceneStatus } from '../shared/types'

function argRoot(): string {
  const i = process.argv.indexOf('--project')
  const r = i >= 0 ? process.argv[i + 1] : process.env.NOVEL_ROOT
  if (!r) throw new Error('novel-server: --project <root> is required')
  return path.resolve(r)
}

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const json = (v: unknown) => ok(JSON.stringify(v, null, 2))
const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `Error: ${(e as Error).message ?? e}` }], isError: true })

const kindSchema = z.enum(BIBLE_KINDS as [BibleKind, ...BibleKind[]])
const statusSchema = z.enum(['idea', 'outlined', 'drafted', 'revised', 'final'])

export function buildServer(root: string): McpServer {
  const server = new McpServer({ name: 'novel', version: '0.1.0' })

  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    fn: (args: z.infer<z.ZodObject<S>>) => unknown | Promise<unknown>
  ) =>
    server.registerTool(name, { description, inputSchema: shape }, (async (args: z.infer<z.ZodObject<S>>) => {
      try {
        const r = await fn(args)
        return typeof r === 'string' ? ok(r) : json(r)
      } catch (e) {
        return fail(e)
      }
    }) as never)

  tool('project_overview', 'Book facts (title, POV, tense, targets), chapter/scene list with word counts and statuses, and bible index. Call this first in a new conversation.', {}, () => {
    const cfg = loadConfig(root)
    const chapters = listChapters(root)
    return {
      config: cfg,
      totalWords: chapters.reduce((a, c) => a + c.words, 0),
      chapters: chapters.map((c) => ({
        folder: c.folder,
        title: c.title,
        words: c.words,
        scenes: c.scenes.map((s) => ({ path: s.path, title: s.title, status: s.status, pov: s.pov, words: s.words, summary: s.summary }))
      })),
      bible: listBible(root).map((e) => ({ kind: e.kind, scope: e.scope, name: e.name, path: e.path, summary: e.summary })),
      series: (() => {
        const si = loadSeries(root)
        return si ? { title: si.config.title, thisBook: cfg.seriesNumber, books: si.books.map((b) => ({ number: b.number, title: b.title, folder: b.folder, words: b.words })) } : null
      })()
    }
  })

  tool(
    'series_overview',
    'For books in a series: the series config, every book (number, folder, words, premise, scene summaries) and the series bible index. Paths are relative to this book (../NN-book/...).',
    { includeSummaries: z.boolean().default(true) },
    ({ includeSummaries }) => {
      const si = loadSeries(root)
      if (!si) return 'This book is not part of a series.'
      return {
        series: si.config,
        totalWords: si.totalWords,
        seriesFiles: si.files,
        books: listBooks(si.root, root).map((b) => ({
          number: b.number,
          title: b.title,
          folder: `../${b.folder}`,
          current: b.current,
          words: b.words,
          premise: b.premise,
          scenes: includeSummaries
            ? listChapters(b.root).flatMap((c) => c.scenes.map((sc) => ({ path: `../${b.folder}/${sc.path}`, title: sc.title, status: sc.status, summary: sc.summary })))
            : undefined
        })),
        seriesBible: listBible(root, undefined, ['series']).map((e) => ({ kind: e.kind, name: e.name, path: e.path, summary: e.summary }))
      }
    }
  )

  tool(
    'project_update_config',
    'Update book facts in novel.json (title, author, genre, pov, tense, targetWords, dailyGoal). For a series, seriesTitle / seriesDescription / plannedBooks update series.json.',
    {
      title: z.string().optional(),
      author: z.string().optional(),
      genre: z.string().optional(),
      pov: z.string().optional(),
      tense: z.string().optional(),
      targetWords: z.number().optional(),
      dailyGoal: z.number().optional(),
      seriesTitle: z.string().optional(),
      seriesDescription: z.string().optional(),
      plannedBooks: z.number().optional()
    },
    ({ seriesTitle, seriesDescription, plannedBooks, ...book }) => {
      const cfg = loadConfig(root)
      const clean = Object.fromEntries(Object.entries(book).filter(([, v]) => v !== undefined))
      saveConfig(root, { ...cfg, ...clean })
      const si = loadSeries(root)
      if (si && (seriesTitle || seriesDescription || plannedBooks)) {
        const sc = loadSeriesConfig(si.root)
        saveSeriesConfig(si.root, {
          ...sc,
          ...(seriesTitle ? { title: seriesTitle } : {}),
          ...(seriesDescription ? { description: seriesDescription } : {}),
          ...(plannedBooks ? { plannedBooks } : {})
        })
      }
      return 'Project settings updated.'
    }
  )

  tool('scene_list', 'List every scene in reading order with metadata (path, title, pov, status, summary, words).', {}, () =>
    listChapters(root).flatMap((c) => c.scenes)
  )

  tool('scene_read', 'Read a scene: returns frontmatter metadata and prose body.', { path: z.string().describe('e.g. manuscript/01-chapter-one/01-opening.md') }, ({ path: p }) =>
    readScene(root, p)
  )

  tool(
    'scene_write',
    'Write a scene (preserves and merges frontmatter). Use mode "append" to continue a scene, "replace" to rewrite it.',
    {
      path: z.string(),
      body: z.string().describe('Markdown prose'),
      mode: z.enum(['replace', 'append']).default('replace'),
      title: z.string().optional(),
      status: statusSchema.optional(),
      summary: z.string().optional(),
      pov: z.string().optional(),
      location: z.string().optional(),
      time: z.string().optional(),
      characters: z.array(z.string()).optional()
    },
    ({ path: p, body, mode, ...meta }) => {
      const abs = resolveInside(root, p)
      const prev = fs.existsSync(abs) ? readScene(root, p).body : ''
      const next = mode === 'append' && prev ? `${prev.trimEnd()}\n\n${body.trim()}` : body
      const info = writeScene(root, p, meta as { status?: SceneStatus }, next)
      return `Wrote ${info.path} (${info.words} words, status ${info.status}).`
    }
  )

  tool('scene_create', 'Create a new empty scene in a chapter (creates the chapter if chapterTitle is given instead of chapter).', {
    chapter: z.string().optional().describe('Existing chapter folder, e.g. 01-chapter-one'),
    chapterTitle: z.string().optional().describe('Create a new chapter with this title'),
    title: z.string(),
    summary: z.string().optional(),
    pov: z.string().optional()
  }, ({ chapter, chapterTitle, title, summary, pov }) => {
    const folder = chapter ?? createChapter(root, chapterTitle ?? 'New Chapter')
    return { created: createScene(root, folder, title, { summary, pov }) }
  })

  tool(
    'bible_list',
    'List story bible entries, optionally filtered by kind. In a series this includes the shared series bible (scope "series").',
    { kind: kindSchema.optional(), scope: z.enum(['book', 'series', 'all']).default('all') },
    ({ kind, scope }) =>
      listBible(root, kind, scope === 'all' ? ['book', 'series'] : [scope]).map((e) => ({ kind: e.kind, scope: e.scope, name: e.name, aliases: e.aliases, summary: e.summary, path: e.path }))
  )

  tool('bible_get', 'Get a full story bible entry by name, alias or slug.', { name: z.string() }, ({ name }) => {
    const e = findBibleEntry(root, name)
    if (!e) throw new Error(`No bible entry named "${name}"`)
    return e
  })

  tool('bible_search', 'Full-text search the story bible.', { query: z.string() }, ({ query }) =>
    searchBible(root, query).slice(0, 15).map((e) => ({ kind: e.kind, name: e.name, summary: e.summary, path: e.path }))
  )

  tool(
    'bible_upsert',
    'Create or update a story bible entry. Fields become YAML frontmatter (e.g. role, age, appearance, want, need, flaw, aliases, summary). Body is prose notes.',
    {
      kind: kindSchema,
      name: z.string(),
      fields: z.record(z.string(), z.any()).optional(),
      body: z.string().optional(),
      mode: z.enum(['merge', 'replace']).default('merge'),
      scope: z
        .enum(['book', 'series'])
        .optional()
        .describe('Series projects only: "series" = shared by every book (recurring characters, world rules); "book" = this book only. Default: where the entry already lives, else book.')
    },
    ({ kind, name, fields, body, mode, scope }) => {
      const e = upsertBibleEntry(root, kind, name, fields ?? {}, body, mode, scope)
      return `Saved ${e.path} (${e.scope} bible)`
    }
  )

  tool('continuity_context', 'Everything needed to keep a scene consistent: neighbouring scene summaries, bible entries for characters/places it mentions, the timeline and style guide.', { path: z.string() }, ({ path: p }) =>
    continuityContext(root, p)
  )

  tool('outline_get', 'Read the outline and beat sheet.', {}, () => ({
    outline: readText(path.join(root, 'outline', 'outline.md')),
    beats: readText(path.join(root, 'outline', 'beats.md'))
  }))

  tool('outline_update', 'Replace the outline or beat sheet.', { which: z.enum(['outline', 'beats']), content: z.string() }, ({ which, content }) => {
    writeText(path.join(root, 'outline', `${which}.md`), content)
    return `Updated outline/${which}.md`
  })

  tool('timeline_add', 'Append an event to bible/timeline.md.', { when: z.string(), event: z.string(), chapter: z.string().optional() }, ({ when, event, chapter }) => {
    const f = path.join(root, 'bible', 'timeline.md')
    const prev = readText(f) || '# Timeline\n\n| When | Event | Chapter |\n|------|-------|---------|\n'
    writeText(f, `${prev.trimEnd()}\n| ${when} | ${event.replace(/\|/g, '/')} | ${chapter ?? ''} |\n`)
    return 'Timeline updated.'
  })

  tool('style_guide_get', 'Read the style/voice guide.', {}, () => readText(path.join(root, 'bible', 'style-guide.md')) || '(no style guide yet)')

  tool('word_count', 'Word count for a file, or the whole manuscript if no path given.', { path: z.string().optional() }, ({ path: p }) => {
    if (p) return { path: p, words: countWords(readText(resolveInside(root, p))) }
    const chapters = listChapters(root)
    return { total: chapters.reduce((a, c) => a + c.words, 0), chapters: chapters.map((c) => ({ title: c.title, words: c.words })) }
  })

  tool('report_write', 'Save an editorial or continuity report to .novel/reports/ (shown in the Reports panel).', { name: z.string(), content: z.string() }, ({ name, content }) => {
    const file = `.novel/reports/${new Date().toISOString().slice(0, 10)}-${name.replace(/[^\w-]+/g, '-')}.md`
    writeText(resolveInside(root, file), content)
    return `Saved ${file}`
  })

  tool('snapshot_create', 'Checkpoint the whole project before a large change (the author can rewind to it).', { message: z.string() }, async ({ message }) => {
    const oid = await createSnapshot(root, message)
    return oid ? `Snapshot ${oid.slice(0, 7)} created.` : 'No changes since last snapshot.'
  })

  return server
}

const isMain = process.argv[1] && /mcp(\.js)?$|novel-server/.test(process.argv[1])
if (isMain) {
  const transport = new StdioServerTransport()
  buildServer(argRoot())
    .connect(transport)
    .catch((e) => {
      process.stderr.write(String(e))
      process.exit(1)
    })
}
