import { useEffect, useState } from 'react'
import { BookOpen, Plus, Sparkles, FileText, Library, Check, Settings2, Orbit } from 'lucide-react'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import { InlineInput } from './Sidebar'
import type { SeriesConfig } from '@shared/types'

/** Books in the series, series-level files, series settings and AI helpers. Embedded in the universe panel, it leaves out the book list (the universe tree shows it). */
export function SeriesPanel({ embedded = false }: { embedded?: boolean }) {
  const project = useStore((s) => s.project)!
  const openBook = useStore((s) => s.openBook)
  const addBook = useStore((s) => s.addBook)
  const openTab = useStore((s) => s.openTab)
  const sendToEngine = useStore((s) => s.sendToEngine)
  const notify = useStore((s) => s.notify)
  const set = useStore((s) => s.set)
  const series = project.series

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [cfg, setCfg] = useState<SeriesConfig | null>(series?.config ?? null)
  useEffect(() => setCfg(series?.config ?? null), [series?.config])

  if (!series) {
    return (
      <div className="px-3 py-4 text-[12.5px] text-muted">
        <p className="mb-3">This novel is a standalone book. Turn it into Book 1 of a series to share a story bible across several books.</p>
        <button className="btn w-full justify-center" onClick={() => set({ dialog: 'make-series' })}>
          <Library size={13} /> Turn into a series
        </button>
        <p className="mb-3 mt-5">Or make it part of a shared universe, where several series and standalone books share one world.</p>
        <button className="btn w-full justify-center" onClick={() => set({ dialog: 'make-universe' })}>
          <Orbit size={13} /> Bring into a universe
        </button>
      </div>
    )
  }

  const run = async (name: string, args = '') => {
    const text = await api.commands.expand(name, args)
    if (text) void sendToEngine(text, { display: `/${name} ${args}`.trim() })
  }
  const prefix = series.files[0]?.split('/')[0] ?? '..'
  const pct = Math.min(100, Math.round((series.books.length / Math.max(series.config.plannedBooks, 1)) * 100))

  return (
    <div>
      <div className="mx-2 mb-2 rounded-lg border border-line bg-panel2 p-2.5">
        <div className="flex items-center gap-1.5">
          <Library size={14} className="text-accent" />
          <span className="truncate font-semibold">{series.config.title}</span>
          <button className="ml-auto rounded p-0.5 text-faint hover:text-fg" title="Series settings" onClick={() => setEditing(!editing)}>
            <Settings2 size={13} />
          </button>
        </div>
        <div className="mt-1 text-[11.5px] text-faint">
          {series.books.length} of {series.config.plannedBooks} books · {series.totalWords.toLocaleString()} words
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {editing && cfg && (
        <div className="mx-2 mb-2 space-y-1.5 rounded-lg border border-line p-2.5 text-[12px] text-muted">
          <label className="block">
            Series title
            <input className="field mt-0.5 w-full" value={cfg.title} onChange={(e) => setCfg({ ...cfg, title: e.target.value })} />
          </label>
          <label className="block">
            Planned books
            <input type="number" min={1} className="field mt-0.5 w-full" value={cfg.plannedBooks} onChange={(e) => setCfg({ ...cfg, plannedBooks: Number(e.target.value) })} />
          </label>
          <label className="block">
            Series premise
            <textarea rows={3} className="field mt-0.5 w-full resize-none" value={cfg.description} onChange={(e) => setCfg({ ...cfg, description: e.target.value })} />
          </label>
          <button
            className="btn btn-primary w-full justify-center py-1 text-[12px]"
            onClick={async () => {
              await api.series.saveConfig(cfg)
              setEditing(false)
              notify('Series settings saved.')
            }}
          >
            Save
          </button>
        </div>
      )}

      {!embedded && <div className="px-3 pb-1 pt-1 section-label">Books</div>}
      {!embedded && series.books.map((b) => (
        <button
          key={b.root}
          disabled={b.current}
          onClick={() => void openBook(b.root)}
          title={b.premise}
          className={`mx-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] disabled:opacity-100 ${
            b.current ? 'cursor-default bg-raised text-fg' : 'text-muted hover:bg-panel2 hover:text-fg'
          }`}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-line text-[11px] font-semibold text-fg">{b.number}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{b.title}</span>
            <span className="text-[11px] text-faint">{b.words.toLocaleString()} words</span>
          </span>
          {b.current ? <Check size={13} className="text-accent" /> : <BookOpen size={13} className="text-faint" />}
        </button>
      ))}
      {embedded ? null : adding ? (
        <InlineInput
          placeholder={`Title of book ${series.books.length + 1}`}
          onCancel={() => setAdding(false)}
          onSubmit={async (t) => {
            setAdding(false)
            await addBook(t)
          }}
        />
      ) : (
        <div className="px-2 pt-1">
          <button className="btn w-full justify-center py-1 text-[12px]" onClick={() => setAdding(true)}>
            <Plus size={13} /> Add book {series.books.length + 1}
          </button>
        </div>
      )}

      <div className="px-3 pb-1 pt-4 section-label">Series files</div>
      {[
        [`${prefix}/series-outline.md`, 'Series outline'],
        [`${prefix}/SERIES.md`, 'Series instructions for the AI'],
        [`${prefix}/bible/timeline.md`, 'Series timeline'],
        [`${prefix}/bible/style-guide.md`, 'Series style guide']
      ].map(([p, label]) => (
        <button key={p} className="mx-1 flex w-[calc(100%-8px)] items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] text-muted hover:bg-panel2 hover:text-fg" onClick={() => openTab({ kind: 'file', path: p })}>
          <FileText size={13} /> {label}
        </button>
      ))}
      <p className="px-3 pt-1 text-[11.5px] text-faint">Recurring characters, places and lore live in the series bible (Story Bible tab).</p>

      <div className="mt-3 border-t border-line px-2 pt-3">
        <div className="mb-1 px-2.5 text-[11.5px] font-medium text-faint">With the AI</div>
        <button className="action-row" onClick={() => void run('series-plan')}>
          <Sparkles size={13} /> Develop the series arc
        </button>
        <button className="action-row" onClick={() => void run('next-book')}>
          <Sparkles size={13} /> Plan the next book
        </button>
        <button className="action-row" onClick={() => void run('continuity', 'this book against the series bible and earlier books')}>
          <Sparkles size={13} /> Series continuity check
        </button>
      </div>
      {!embedded && (
        <div className="mt-3 border-t border-line px-2 pt-3">
          <button className="action-row" onClick={() => set({ dialog: 'make-universe' })}>
            <Orbit size={13} /> Bring this series into a universe
          </button>
        </div>
      )}
    </div>
  )
}
