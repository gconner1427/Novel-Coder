// Novel Coder MCP server (stdio). Spawned by both Claude Code and Codex so that either engine
// gets first-class tools for the story bible, manuscript, outline and continuity.
//   electron.exe out/main/mcp.js --project <root>     (with ELECTRON_RUN_AS_NODE=1)
import path from 'node:path'
import fs from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  bibleScopes,
  continuityContext,
  findAppearances,
  findSeriesRoot,
  findUniverseRoot,
  listBibleCategories,
  loadUniverse,
  saveBibleCategory,
  saveUniverseConfig,
  loadUniverseConfig,
  syncAgentInstructions,
  universeBookRoots,
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
import type { BibleScope, SceneStatus } from '../shared/types'

function argRoot(): string {
  const i = process.argv.indexOf('--project')
  const r = i >= 0 ? process.argv[i + 1] : process.env.NOVEL_ROOT
  if (!r) throw new Error('novel-server: --project <root> is required')
  return path.resolve(r)
}

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const json = (v: unknown) => ok(JSON.stringify(v, null, 2))
const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `Error: ${(e as Error).message ?? e}` }], isError: true })

const kindSchema = z.string().describe('Bible category slug, e.g. "characters". The author defines the categories; see bible_categories.')
const scopeSchema = z.enum(['book', 'series', 'universe'])
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
      bibleCategories: listBibleCategories(root).map((c) => ({ slug: c.slug, name: c.name, scopes: c.scopes })),
      series: (() => {
        const si = loadSeries(root)
        return si ? { title: si.config.title, thisBook: cfg.seriesNumber, books: si.books.map((b) => ({ number: b.number, title: b.title, folder: b.folder, words: b.words })) } : null
      })(),
      universe: (() => {
        const u = findUniverseRoot(root)
        return u ? { title: loadUniverseConfig(u).title, folder: path.relative(root, u).split(path.sep).join('/'), note: 'Call universe_overview for every series and book.' } : null
      })()
    }
  })

  tool(
    'universe_overview',
    'For books in a shared universe: the universe config, every series (with its books) and every standalone, crossover events and their parts, and the universe bible index. Paths are relative to this book.',
    { includeSummaries: z.boolean().default(false).describe('Also list every scene summary of every book (long in a big universe).') },
    ({ includeSummaries }) => {
      const u = loadUniverse(root)
      if (!u) return 'This book is not part of a universe.'
      const rel = (abs: string) => path.relative(root, abs).split(path.sep).join('/') || '.'
      const book = (b: { root: string; number: number; title: string; words: number; premise?: string; format?: string; crossover?: unknown; current: boolean }) => ({
        number: b.number,
        title: b.title,
        folder: rel(b.root),
        current: b.current,
        format: b.format ?? 'novel',
        words: b.words,
        premise: b.premise,
        crossover: b.crossover,
        scenes: includeSummaries
          ? listChapters(b.root).flatMap((c) => c.scenes.map((sc) => ({ path: `${rel(b.root)}/${sc.path}`, title: sc.title, summary: sc.summary })))
          : undefined
      })
      return {
        universe: u.config,
        totalWords: u.totalWords,
        universeFiles: u.files,
        series: u.series.map((s) => ({ title: s.title, folder: rel(s.root), plannedBooks: s.plannedBooks, current: s.current, books: s.books.map(book) })),
        standalones: u.standalones.map(book),
        crossovers: u.crossovers.map((c) => ({ event: c.event, parts: c.parts.map((p) => ({ part: p.part, title: p.title, series: p.seriesTitle ?? null, folder: p.path, current: p.current })) })),
        universeBible: listBible(root, undefined, ['universe']).map((e) => ({ kind: e.kind, name: e.name, path: e.path, summary: e.summary }))
      }
    }
  )

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
          format: b.format ?? 'novel',
          crossover: b.crossover,
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
    'Update book facts in novel.json (title, author, genre, pov, tense, targetWords, dailyGoal, format, crossover). For a series, seriesTitle / seriesDescription / plannedBooks update series.json; in a universe, universeTitle / universeDescription update universe.json.',
    {
      title: z.string().optional(),
      author: z.string().optional(),
      genre: z.string().optional(),
      pov: z.string().optional(),
      tense: z.string().optional(),
      targetWords: z.number().optional(),
      dailyGoal: z.number().optional(),
      format: z.enum(['novel', 'novella', 'short-story']).optional(),
      crossover: z
        .object({ event: z.string(), part: z.number().int().min(1) })
        .nullable()
        .optional()
        .describe('Universe books only: make this book part N of a crossover event (books with the same event name are its parts). null removes it.'),
      seriesTitle: z.string().optional(),
      seriesDescription: z.string().optional(),
      plannedBooks: z.number().optional(),
      universeTitle: z.string().optional(),
      universeDescription: z.string().optional()
    },
    ({ seriesTitle, seriesDescription, plannedBooks, universeTitle, universeDescription, crossover, ...book }) => {
      const cfg = loadConfig(root)
      const clean = Object.fromEntries(Object.entries(book).filter(([, v]) => v !== undefined))
      const next = { ...cfg, ...clean }
      if (crossover === null) delete next.crossover
      else if (crossover) {
        if (!findUniverseRoot(root)) throw new Error('Crossovers are for books in a universe.')
        next.crossover = { event: crossover.event.trim(), part: crossover.part }
      }
      saveConfig(root, next)
      const u = findUniverseRoot(root)
      // Other books list this one (and its crossover part) in their instructions.
      if (u) for (const b of universeBookRoots(u)) syncAgentInstructions(b)
      if (u && (universeTitle || universeDescription)) {
        saveUniverseConfig(u, {
          ...loadUniverseConfig(u),
          ...(universeTitle ? { title: universeTitle } : {}),
          ...(universeDescription ? { description: universeDescription } : {})
        })
      }
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
    'List story bible entries, optionally filtered by category. In a series this includes the shared series bible (scope "series"), and in a universe the universe bible (scope "universe").',
    { kind: kindSchema.optional(), scope: z.enum(['book', 'series', 'universe', 'all']).default('all') },
    ({ kind, scope }) =>
      listBible(root, kind, scope === 'all' ? undefined : [scope]).map((e) => ({ kind: e.kind, scope: e.scope, name: e.name, aliases: e.aliases, summary: e.summary, path: e.path }))
  )

  tool(
    'bible_categories',
    "The story bible's categories (the author decides them): slug, name, the fields new entries start with, the author's guidance on what to record, and which bibles (book/series/universe) have each one.",
    {},
    () => ({ layers: bibleScopes(root), categories: listBibleCategories(root) })
  )

  tool(
    'bible_category_save',
    'Create a story bible category, or change its settings. Only do this when the author asks for a new category or agrees to one.',
    {
      name: z.string().describe('Category name, e.g. "Powers & Abilities", or the slug of an existing category'),
      scope: scopeSchema.default('book').describe('Which bible gets the category. In a universe, use "universe" so every series and book shares it.'),
      noun: z.string().optional().describe('Singular for one entry, e.g. "power"'),
      fields: z.array(z.string()).optional().describe('Fields every new entry starts with, e.g. ["source", "limits", "users"]'),
      guidance: z.string().optional().describe('What to record for each entry in this category')
    },
    ({ name, scope, ...opts }) => {
      const c = saveBibleCategory(root, name, scope as BibleScope, opts)
      return `Saved category ${c.slug} (${c.name}) in the ${scope} bible.`
    }
  )

  tool(
    'bible_appearances',
    'Every scene where a character, place or other bible entry appears, across this book and (in a series or universe) every other book: listed in the scene frontmatter, or mentioned in the prose. Use before writing a character who has appeared elsewhere.',
    { name: z.string().describe('Bible entry name, alias or slug (or any name)') },
    ({ name }) => {
      const found = findAppearances(root, name)
      return found.length ? found : `No scene mentions "${name}".`
    }
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
    'Create or update a story bible entry. Fields become YAML frontmatter (e.g. role, age, appearance, want, need, flaw, aliases, summary). Body is prose notes. Use an existing category (see bible_categories) unless the author asked for a new one.',
    {
      kind: kindSchema,
      name: z.string(),
      fields: z.record(z.string(), z.any()).optional(),
      body: z.string().optional(),
      mode: z.enum(['merge', 'replace']).default('merge'),
      scope: scopeSchema
        .optional()
        .describe(
          '"universe" = shared by every series and book in the universe (characters who cross over, teams, world rules); "series" = shared by every book in this series; "book" = this book only. Default: where the entry already lives, else book.'
        )
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

  const layerRoot = (scope: BibleScope) => {
    const r = scope === 'book' ? root : scope === 'series' ? findSeriesRoot(root) : findUniverseRoot(root)
    if (!r) throw new Error(`This book is not part of a ${scope}.`)
    return r
  }

  tool(
    'timeline_add',
    'Append an event to a timeline: this book\'s bible/timeline.md, or the series or universe timeline for events that matter beyond this book.',
    {
      when: z.string(),
      event: z.string(),
      chapter: z.string().optional().describe('Chapter (book timeline) or book (series/universe timeline) where it happens'),
      scope: scopeSchema.default('book')
    },
    ({ when, event, chapter, scope }) => {
      const f = path.join(layerRoot(scope as BibleScope), 'bible', 'timeline.md')
      const col = scope === 'book' ? 'Chapter' : 'Book'
      const prev = readText(f) || `# Timeline\n\n| When | Event | ${col} |\n|------|-------|------|\n`
      writeText(f, `${prev.trimEnd()}\n| ${when} | ${event.replace(/\|/g, '/')} | ${(chapter ?? '').replace(/\|/g, '/')} |\n`)
      return `${scope === 'book' ? 'Book' : scope === 'series' ? 'Series' : 'Universe'} timeline updated.`
    }
  )

  tool('style_guide_get', 'Read the style/voice guides that apply to this book: the universe, series and book guides that exist, broadest first.', {}, () => {
    const parts = (['universe', 'series', 'book'] as BibleScope[])
      .filter((s) => bibleScopes(root).includes(s))
      .map((s) => ({ s, text: readText(path.join(layerRoot(s), 'bible', 'style-guide.md')) }))
      .filter((x) => x.text.trim())
      .map((x) => `<!-- ${x.s} style guide -->\n${x.text}`)
    return parts.join('\n\n') || '(no style guide yet)'
  })

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
