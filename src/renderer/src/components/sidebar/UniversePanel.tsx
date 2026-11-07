import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, Check, ChevronRight, FileText, Library, Orbit, Plus, Settings2, Sparkles, Swords } from 'lucide-react'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import { InlineInput } from './Sidebar'
import { SeriesPanel } from './SeriesPanel'
import type { BookFormat, BookInfo, UniverseConfig, UniverseInfo } from '@shared/types'

export const FORMAT_NAME: Record<BookFormat, string> = { novel: 'Novel', novella: 'Novella', 'short-story': 'Short story' }

/** The universe home: every series and standalone, crossovers, universe settings and files. */
export function UniversePanel() {
  const project = useStore((s) => s.project)!
  const openBook = useStore((s) => s.openBook)
  const addBook = useStore((s) => s.addBook)
  const addSeries = useStore((s) => s.addSeries)
  const addStandalone = useStore((s) => s.addStandalone)
  const openTab = useStore((s) => s.openTab)
  const sendToEngine = useStore((s) => s.sendToEngine)
  const notify = useStore((s) => s.notify)
  const light = project.universe!

  // The project snapshot skips word counts across the universe; load them while this panel is open.
  const [full, setFull] = useState<UniverseInfo | null>(null)
  useEffect(() => {
    let live = true
    const t = setTimeout(() => void api.universe.load().then((u) => live && setFull(u ?? null)), full ? 700 : 0)
    return () => {
      live = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])
  const u = full && full.root === light.root ? full : light
  const counted = u === full

  const [open, setOpen] = useState<Record<string, boolean>>({})
  const isOpen = (folder: string, current: boolean) => open[folder] ?? current
  const [addingBookTo, setAddingBookTo] = useState<string | null>(null)
  const [form, setForm] = useState<null | 'series' | 'standalone'>(null)
  const [editing, setEditing] = useState(false)
  const [cfg, setCfg] = useState<UniverseConfig>(light.config)
  useEffect(() => setCfg(light.config), [light.config])

  const run = async (name: string, args = '') => {
    const text = await api.commands.expand(name, args)
    if (text) void sendToEngine(text, { display: `/${name} ${args}`.trim() })
  }
  const attempt = async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }
  const books = u.series.reduce((a, s) => a + s.books.length, 0) + u.standalones.length
  const pre = u.prefix

  return (
    <div data-testid="universe-panel">
      <div className="mx-2 mb-2 rounded-lg border border-line bg-panel2 p-2.5">
        <div className="flex items-center gap-1.5">
          <Orbit size={14} className="text-accent" />
          <span className="truncate font-semibold">{u.config.title}</span>
          <button className="ml-auto rounded p-0.5 text-faint hover:text-fg" title="Universe settings" onClick={() => setEditing(!editing)}>
            <Settings2 size={13} />
          </button>
        </div>
        <div className="mt-1 text-[11.5px] text-faint">
          {u.series.length} {u.series.length === 1 ? 'series' : 'series'} · {u.standalones.length} {u.standalones.length === 1 ? 'standalone' : 'standalones'} · {books}{' '}
          {books === 1 ? 'book' : 'books'}
          {counted ? ` · ${u.totalWords.toLocaleString()} words` : ''}
        </div>
      </div>

      {editing && (
        <div className="mx-2 mb-2 space-y-1.5 rounded-lg border border-line p-2.5 text-[12px] text-muted">
          <label className="block">
            Universe title
            <input className="field mt-0.5 w-full" value={cfg.title} onChange={(e) => setCfg({ ...cfg, title: e.target.value })} />
          </label>
          <label className="block">
            Universe premise
            <textarea rows={3} className="field mt-0.5 w-full resize-none" value={cfg.description} onChange={(e) => setCfg({ ...cfg, description: e.target.value })} />
          </label>
          <button
            className="btn btn-primary w-full justify-center py-1 text-[12px]"
            onClick={() =>
              void attempt(async () => {
                await api.universe.saveConfig(cfg)
                setEditing(false)
                notify('Universe settings saved.')
              })
            }
          >
            Save
          </button>
        </div>
      )}

      <Label>Series</Label>
      {u.series.length === 0 && <p className="px-3 pb-1 text-[12px] text-faint">No series yet.</p>}
      {u.series.map((s) => {
        const expanded = isOpen(s.folder, s.current)
        const next = s.books.length ? Math.max(...s.books.map((b) => b.number)) + 1 : 1
        return (
          <div key={s.root} className="mb-0.5">
            <button
              className="mx-1 flex w-[calc(100%-8px)] items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] text-fg hover:bg-panel2"
              aria-expanded={expanded}
              onClick={() => setOpen({ ...open, [s.folder]: !expanded })}
            >
              <ChevronRight size={13} className={`shrink-0 text-faint transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
              <Library size={13} className={s.current ? 'text-accent' : 'text-faint'} />
              <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
              <span className="text-[11px] tabular-nums text-faint">
                {s.books.length}/{s.plannedBooks}
              </span>
            </button>
            {expanded && (
              <div className="anim-fade pl-4">
                {s.books.map((b) => (
                  <BookRow key={b.root} book={b} badge={String(b.number)} counted={counted} onOpen={() => void attempt(() => openBook(b.root))} />
                ))}
                {addingBookTo === s.root ? (
                  <InlineInput
                    placeholder={`Title of book ${next}`}
                    onCancel={() => setAddingBookTo(null)}
                    onSubmit={(t) => {
                      setAddingBookTo(null)
                      void attempt(() => addBook(t, s.root))
                    }}
                  />
                ) : (
                  <button className="mx-1 flex w-[calc(100%-8px)] items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] text-faint hover:bg-panel2 hover:text-fg" onClick={() => setAddingBookTo(s.root)}>
                    <Plus size={12} /> Add book {next}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      <Label>Standalones</Label>
      {u.standalones.length === 0 && <p className="px-3 pb-1 text-[12px] text-faint">No standalone books yet.</p>}
      {u.standalones.map((b) => (
        <BookRow key={b.root} book={b} counted={counted} onOpen={() => void attempt(() => openBook(b.root))} />
      ))}

      <div className="mt-2 flex gap-1.5 px-2">
        <button className={`btn flex-1 justify-center py-1 text-[12px] ${form === 'series' ? 'border-accent' : ''}`} onClick={() => setForm(form === 'series' ? null : 'series')}>
          <Plus size={13} /> New series
        </button>
        <button className={`btn flex-1 justify-center py-1 text-[12px] ${form === 'standalone' ? 'border-accent' : ''}`} onClick={() => setForm(form === 'standalone' ? null : 'standalone')}>
          <Plus size={13} /> New standalone
        </button>
      </div>
      {form === 'series' && (
        <NewSeriesForm
          onCancel={() => setForm(null)}
          onCreate={(series, book) =>
            void attempt(async () => {
              setForm(null)
              await addSeries(series, book)
            })
          }
        />
      )}
      {form === 'standalone' && (
        <NewStandaloneForm
          onCancel={() => setForm(null)}
          onCreate={(title, format) =>
            void attempt(async () => {
              setForm(null)
              await addStandalone(title, format)
            })
          }
        />
      )}

      <Label>Crossovers</Label>
      {u.crossovers.length === 0 ? (
        <p className="px-3 text-[11.5px] leading-relaxed text-faint">
          A crossover is one story told across books in different series. Set each book's crossover event and part in Settings, under This book.
        </p>
      ) : (
        u.crossovers.map((c) => (
          <div key={c.event} className="mb-1">
            <div className="group mx-1 flex items-center gap-1.5 px-2 py-1 text-[13px] font-medium text-fg">
              <Swords size={13} className="text-accent" />
              <span className="min-w-0 flex-1 truncate">{c.event}</span>
              <button className="rounded p-0.5 text-faint opacity-0 hover:text-fg group-hover:opacity-100" title="Plan or check this crossover with the AI" onClick={() => void run('crossover', c.event)}>
                <Sparkles size={12} />
              </button>
            </div>
            {c.parts.map((p) => (
              <button
                key={p.root}
                disabled={p.current}
                onClick={() => void attempt(() => openBook(p.root))}
                className={`mx-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-md py-1 pl-6 pr-2 text-left text-[12.5px] disabled:opacity-100 ${
                  p.current ? 'cursor-default bg-raised text-fg' : 'text-muted hover:bg-panel2 hover:text-fg'
                }`}
              >
                <span className="shrink-0 text-[11px] tabular-nums text-faint">Part {p.part}</span>
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <span className="max-w-[40%] shrink-0 truncate text-[11px] text-faint">{p.seriesTitle ?? 'standalone'}</span>
              </button>
            ))}
          </div>
        ))
      )}

      <Label>Universe files</Label>
      {[
        [`${pre}/universe-outline.md`, 'Universe outline'],
        [`${pre}/UNIVERSE.md`, 'Universe instructions for the AI'],
        [`${pre}/bible/timeline.md`, 'Universe timeline'],
        [`${pre}/bible/style-guide.md`, 'Universe style guide']
      ].map(([p, label]) => (
        <button key={p} className="mx-1 flex w-[calc(100%-8px)] items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] text-muted hover:bg-panel2 hover:text-fg" onClick={() => openTab({ kind: 'file', path: p })}>
          <FileText size={13} /> {label}
        </button>
      ))}
      <p className="px-3 pt-1 text-[11.5px] text-faint">Characters, teams and lore shared across series live in the universe bible (Story Bible tab).</p>

      <div className="mt-3 border-t border-line px-2 pt-3">
        <div className="mb-1 px-2.5 text-[11.5px] font-medium text-faint">With the AI</div>
        <button className="action-row" onClick={() => void run('universe-plan')}>
          <Sparkles size={13} /> Develop the universe plan
        </button>
        <button className="action-row" onClick={() => void run('continuity', 'this book against the universe bible and the other books in the universe')}>
          <Sparkles size={13} /> Universe continuity check
        </button>
      </div>

      {project.series && (
        <div className="mt-4 border-t border-line pt-3">
          <Label>This series</Label>
          <SeriesPanel embedded />
        </div>
      )}
    </div>
  )
}

function Label({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1 pt-3 section-label">{children}</div>
}

function BookRow({ book, badge, counted, onOpen }: { book: BookInfo; badge?: string; counted: boolean; onOpen: () => void }) {
  const format = book.format && book.format !== 'novel' ? FORMAT_NAME[book.format] : null
  const details = [counted ? `${book.words.toLocaleString()} words` : null, format, book.crossover ? `${book.crossover.event}, part ${book.crossover.part}` : null].filter(Boolean)
  return (
    <button
      disabled={book.current}
      onClick={onOpen}
      title={book.premise}
      className={`mx-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] disabled:opacity-100 ${
        book.current ? 'cursor-default bg-raised text-fg' : 'text-muted hover:bg-panel2 hover:text-fg'
      }`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-line text-[11px] font-semibold text-fg">{badge ?? <BookOpen size={11} />}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{book.title}</span>
        {details.length > 0 && <span className="truncate text-[11px] text-faint">{details.join(' · ')}</span>}
      </span>
      {book.current ? <Check size={13} className="shrink-0 text-accent" /> : <BookOpen size={13} className="shrink-0 text-faint" />}
    </button>
  )
}

function NewSeriesForm({ onCreate, onCancel }: { onCreate: (series: string, book: string) => void; onCancel: () => void }) {
  const [series, setSeries] = useState('')
  const [book, setBook] = useState('')
  const ok = series.trim() && book.trim()
  return (
    <form
      className="mx-2 mt-1.5 space-y-1.5 rounded-lg border border-line p-2.5 text-[12px] text-muted"
      onSubmit={(e) => {
        e.preventDefault()
        if (ok) onCreate(series.trim(), book.trim())
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <label className="block">
        Series title
        <input autoFocus className="field mt-0.5 w-full" value={series} onChange={(e) => setSeries(e.target.value)} placeholder="Night Court" />
      </label>
      <label className="block">
        Title of book 1
        <input className="field mt-0.5 w-full" value={book} onChange={(e) => setBook(e.target.value)} />
      </label>
      <button type="submit" disabled={!ok} className="btn btn-primary w-full justify-center py-1 text-[12px]">
        Create series and open book 1
      </button>
    </form>
  )
}

function NewStandaloneForm({ onCreate, onCancel }: { onCreate: (title: string, format: BookFormat) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [format, setFormat] = useState<BookFormat>('novel')
  return (
    <form
      className="mx-2 mt-1.5 space-y-1.5 rounded-lg border border-line p-2.5 text-[12px] text-muted"
      onSubmit={(e) => {
        e.preventDefault()
        if (title.trim()) onCreate(title.trim(), format)
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <label className="block">
        Title
        <input autoFocus className="field mt-0.5 w-full" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Long Night" />
      </label>
      <label className="block">
        Format
        <select className="field mt-0.5 w-full" value={format} onChange={(e) => setFormat(e.target.value as BookFormat)}>
          {(Object.keys(FORMAT_NAME) as BookFormat[]).map((f) => (
            <option key={f} value={f}>
              {FORMAT_NAME[f]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={!title.trim()} className="btn btn-primary w-full justify-center py-1 text-[12px]">
        Create and open
      </button>
    </form>
  )
}
