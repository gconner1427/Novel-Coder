import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  BookText,
  BookOpen,
  Users,
  ListTree,
  FolderTree,
  History,
  Camera,
  FileWarning,
  Plus,
  ChevronRight,
  ChevronDown,
  Trash2,
  Sparkles,
  Search,
  LayoutGrid,
  RotateCcw,
  MapPin,
  ScrollText,
  User,
  FileText,
  Pencil,
  ShieldCheck,
  Library,
  ChevronsDownUp,
  ChevronsUpDown,
  X
} from 'lucide-react'
import { SeriesPanel } from './SeriesPanel'
import { api } from '../../lib/api'
import { useStore, type SidebarTab } from '../../store'
import { Empty, EngineDot, StatusPill, docTitle, timeAgo } from '../ui'
import type { BibleKind, Snapshot } from '@shared/types'

const TABS: { id: SidebarTab; icon: ReactNode; label: string }[] = [
  { id: 'series', icon: <Library size={17} />, label: 'Series' },
  { id: 'manuscript', icon: <BookText size={17} />, label: 'Manuscript' },
  { id: 'bible', icon: <Users size={17} />, label: 'Story Bible' },
  { id: 'outline', icon: <ListTree size={17} />, label: 'Outline' },
  { id: 'files', icon: <FolderTree size={17} />, label: 'All files' },
  { id: 'history', icon: <History size={17} />, label: 'Conversations' },
  { id: 'snapshots', icon: <Camera size={17} />, label: 'Snapshots & Rewind' },
  { id: 'reports', icon: <FileWarning size={17} />, label: 'Reports' }
]

export function Sidebar() {
  const tab = useStore((s) => s.sidebar)
  const set = useStore((s) => s.set)
  return (
    <div className="flex shrink-0">
      <nav className="flex w-12 flex-col items-center gap-1 border-r border-line bg-bg py-2.5" aria-label="Sidebar">
        {TABS.map((t) => {
          const on = tab === t.id
          return (
            <button
              key={t.id}
              title={t.label}
              aria-current={on ? 'page' : undefined}
              onClick={() => set({ sidebar: t.id })}
              className={`icon-btn relative h-9 w-9 ${on ? 'bg-panel2 text-fg' : 'text-faint'}`}
            >
              {on && <span className="absolute -left-[7px] top-2 bottom-2 w-[3px] rounded-r-full bg-accent" style={{ boxShadow: '0 0 10px var(--accent)' }} />}
              {t.icon}
            </button>
          )
        })}
      </nav>
      <div className="flex w-[264px] flex-col bg-panel">
        <div className="flex h-10 shrink-0 items-center px-4 text-[13.5px] font-semibold tracking-[-0.01em] text-fg">{TABS.find((t) => t.id === tab)?.label}</div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {tab === 'series' && <SeriesPanel />}
          {tab === 'manuscript' && <ManuscriptPanel />}
          {tab === 'bible' && <BiblePanel />}
          {tab === 'outline' && <OutlinePanel />}
          {tab === 'files' && <FilesPanel />}
          {tab === 'history' && <HistoryPanel />}
          {tab === 'snapshots' && <SnapshotsPanel />}
          {tab === 'reports' && <ReportsPanel />}
        </div>
      </div>
    </div>
  )
}

export function InlineInput({ placeholder, onSubmit, onCancel, initial = '' }: { placeholder: string; onSubmit: (v: string) => void; onCancel: () => void; initial?: string }) {
  const [v, setV] = useState(initial)
  return (
    <form
      className="px-2 py-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (v.trim()) onSubmit(v.trim())
      }}
    >
      <input autoFocus className="field w-full text-[12.5px]" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onBlur={onCancel} onKeyDown={(e) => e.key === 'Escape' && onCancel()} />
    </form>
  )
}

function Row({
  active,
  onClick,
  children,
  actions,
  indent = 0,
  draggable,
  onDragStart,
  onDrop,
  title
}: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  actions?: ReactNode
  indent?: number
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  title?: string
}) {
  const [over, setOver] = useState(false)
  return (
    <div
      title={title}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        if (!onDrop) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        onDrop?.(e)
      }}
      onClick={onClick}
      className={`group mx-2 flex cursor-pointer items-center gap-1.5 rounded-[7px] py-[5px] pr-1 text-[13px] transition-colors ${
        active ? 'bg-raised text-fg shadow-[var(--shadow-sm)]' : 'text-muted hover:bg-panel2 hover:text-fg'
      } ${over ? 'ring-1 ring-accent' : ''}`}
      style={{ paddingLeft: 8 + indent * 14 }}
    >
      {children}
      {actions && <span className="ml-auto hidden items-center gap-0.5 group-hover:flex">{actions}</span>}
    </div>
  )
}

const MiniBtn = ({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) => (
  <button
    title={title}
    className="rounded p-0.5 text-faint hover:bg-raised hover:text-fg"
    onClick={(e) => {
      e.stopPropagation()
      onClick()
    }}
  >
    {children}
  </button>
)

function useActivePath() {
  const active = useStore((s) => s.active)
  return active?.startsWith('file:') ? active.slice(5) : null
}

// ---------------- manuscript ----------------

function ManuscriptPanel() {
  const project = useStore((s) => s.project)!
  const openTab = useStore((s) => s.openTab)
  const sendToEngine = useStore((s) => s.sendToEngine)
  const notify = useStore((s) => s.notify)
  const activePath = useActivePath()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [adding, setAdding] = useState<string | null>(null) // chapter folder or '__chapter'
  const [renaming, setRenaming] = useState<string | null>(null)

  const runCmd = async (name: string, args: string) => {
    const text = await api.commands.expand(name, args)
    if (text) void sendToEngine(text, { display: `/${name} ${args}` })
  }

  return (
    <div>
      <div className="mb-1 flex gap-1 px-2">
        <button className="btn flex-1 justify-center py-1 text-[12px]" onClick={() => setAdding('__chapter')}>
          <Plus size={13} /> Chapter
        </button>
        <button className="btn py-1 text-[12px]" title="Read the whole manuscript" onClick={() => openTab({ kind: 'read' })}>
          <BookOpen size={13} /> Read
        </button>
        <button className="btn py-1 text-[12px]" title="Corkboard" onClick={() => openTab({ kind: 'corkboard' })}>
          <LayoutGrid size={13} />
        </button>
      </div>
      {adding === '__chapter' && (
        <InlineInput
          placeholder="Chapter title"
          onCancel={() => setAdding(null)}
          onSubmit={async (t) => {
            setAdding(null)
            const scene = await api.project.createChapter(t)
            openTab({ kind: 'file', path: scene })
          }}
        />
      )}
      {project.chapters.length === 0 && <Empty>No chapters yet.</Empty>}
      {project.chapters.map((ch) => (
        <div key={ch.folder}>
          {renaming === ch.folder ? (
            <InlineInput
              initial={ch.title}
              placeholder="Chapter title"
              onCancel={() => setRenaming(null)}
              onSubmit={async (t) => {
                setRenaming(null)
                await api.project.renameChapter(ch.folder, t)
              }}
            />
          ) : (
            <Row
              onClick={() => setCollapsed((c) => ({ ...c, [ch.folder]: !c[ch.folder] }))}
              onDrop={async (e) => {
                const rel = e.dataTransfer.getData('text/scene')
                if (rel && !rel.startsWith(`manuscript/${ch.folder}/`)) await api.project.moveScene(rel, ch.folder)
              }}
              actions={
                <>
                  <MiniBtn title="Read this chapter" onClick={() => openTab({ kind: 'read', chapter: ch.folder })}>
                    <BookOpen size={13} />
                  </MiniBtn>
                  <MiniBtn title="Add scene" onClick={() => setAdding(ch.folder)}>
                    <Plus size={13} />
                  </MiniBtn>
                  <MiniBtn title="Rename" onClick={() => setRenaming(ch.folder)}>
                    <Pencil size={12} />
                  </MiniBtn>
                  <MiniBtn title="Continuity check this chapter" onClick={() => void runCmd('continuity', `manuscript/${ch.folder}`)}>
                    <ShieldCheck size={13} />
                  </MiniBtn>
                </>
              }
            >
              {collapsed[ch.folder] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <span className="truncate font-medium text-fg">{ch.title}</span>
              <span className="ml-auto pr-1 text-[11px] text-faint group-hover:hidden">{ch.words.toLocaleString()}</span>
            </Row>
          )}
          {!collapsed[ch.folder] && (
            <>
              {ch.scenes.map((s, i) => (
                <Row
                  key={s.path}
                  indent={1}
                  title={s.summary}
                  active={activePath === s.path}
                  onClick={() => openTab({ kind: 'file', path: s.path })}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/scene', s.path)}
                  onDrop={async (e) => {
                    const rel = e.dataTransfer.getData('text/scene')
                    if (!rel || rel === s.path) return
                    if (rel.startsWith(`manuscript/${ch.folder}/`)) {
                      const order = ch.scenes.map((x) => x.path).filter((p) => p !== rel)
                      order.splice(i, 0, rel)
                      await api.project.reorderScenes(ch.folder, order)
                    } else await api.project.moveScene(rel, ch.folder)
                  }}
                  actions={
                    <>
                      <MiniBtn title="Draft with AI" onClick={() => void runCmd('draft', s.path)}>
                        <Sparkles size={13} />
                      </MiniBtn>
                      <MiniBtn
                        title="Delete scene"
                        onClick={async () => {
                          if (!confirm(`Delete scene "${s.title}"? (You can rewind from Snapshots.)`)) return
                          await api.snapshots.create(`Before deleting ${s.path}`)
                          await api.project.deleteFile(s.path)
                          notify('Scene deleted. Use Snapshots to undo.')
                        }}
                      >
                        <Trash2 size={12} />
                      </MiniBtn>
                    </>
                  }
                >
                  <StatusPill status={s.status} />
                  <span className="truncate">{s.title}</span>
                  <span className="ml-auto pr-1 text-[11px] text-faint group-hover:hidden">{s.words.toLocaleString()}</span>
                </Row>
              ))}
              {adding === ch.folder && (
                <InlineInput
                  placeholder="Scene title"
                  onCancel={() => setAdding(null)}
                  onSubmit={async (t) => {
                    setAdding(null)
                    openTab({ kind: 'file', path: await api.project.createScene(ch.folder, t) })
                  }}
                />
              )}
            </>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------- story bible ----------------

const KIND_META: Record<BibleKind, { label: string; noun: string; icon: ReactNode }> = {
  characters: { label: 'Characters', noun: 'character', icon: <User size={13} /> },
  locations: { label: 'Locations', noun: 'location', icon: <MapPin size={13} /> },
  lore: { label: 'Lore & World', noun: 'lore entry', icon: <ScrollText size={13} /> }
}

type BibleShow = 'all' | 'series' | 'book'

/** Remembered per computer: which bible entries to show, and which sections are folded away. */
const readPref = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
const writePref = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* storage unavailable; the choice just won't be remembered */
  }
}

function SectionHeader({
  open,
  onToggle,
  icon,
  label,
  count,
  actions
}: {
  open: boolean
  onToggle: () => void
  icon: ReactNode
  label: string
  count?: number
  actions?: ReactNode
}) {
  return (
    <Row onClick={onToggle} actions={actions} title={open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>
      <span className="flex items-center gap-1.5" role="button" aria-expanded={open}>
        <ChevronRight size={13} className={`shrink-0 text-faint transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        {icon}
        <span className="font-medium text-fg">{label}</span>
      </span>
      {count !== undefined && <span className="ml-auto pr-1 text-[11px] tabular-nums text-faint group-hover:hidden">{count}</span>}
    </Row>
  )
}

function BiblePanel() {
  const project = useStore((s) => s.project)!
  const openTab = useStore((s) => s.openTab)
  const sendToEngine = useStore((s) => s.sendToEngine)
  const activePath = useActivePath()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState<BibleKind | null>(null)
  const inSeries = !!project.series
  const [showPref, setShowPref] = useState<BibleShow>(() => readPref('novelcoder.bibleShow', 'all'))
  const show: BibleShow = inSeries ? showPref : 'all'
  const [folded, setFolded] = useState<Record<string, boolean>>(() => readPref('novelcoder.bibleFolded', {}))
  // Where a new entry goes. Showing one bible means new entries go there; showing both lets you pick (series by default).
  const [addScope, setAddScope] = useState<'book' | 'series'>('series')
  const scope = !inSeries ? 'book' : show === 'all' ? addScope : show

  const setShow = (v: BibleShow) => {
    setShowPref(v)
    writePref('novelcoder.bibleShow', v)
  }
  const saveFolded = (next: Record<string, boolean>) => {
    setFolded(next)
    writePref('novelcoder.bibleFolded', next)
  }
  const toggle = (key: string) => saveFolded({ ...folded, [key]: !folded[key] })
  const term = q.toLowerCase().trim()
  const searching = term.length > 0
  // While searching, every section opens so no match is hidden behind a fold.
  const isOpen = (key: string) => searching || !folded[key]

  const entries = useMemo(
    () =>
      project.bible.filter(
        (e) => (show === 'all' || e.scope === show) && (!term || `${e.name} ${e.aliases.join(' ')} ${e.summary}`.toLowerCase().includes(term))
      ),
    [project.bible, term, show]
  )
  const counts = useMemo(
    () => ({
      all: project.bible.length,
      series: project.bible.filter((e) => e.scope === 'series').length,
      book: project.bible.filter((e) => e.scope !== 'series').length
    }),
    [project.bible]
  )
  const prefix = project.series?.files[0]?.split('/')[0] ?? '..'
  const kinds = Object.keys(KIND_META) as BibleKind[]
  const allFolded = kinds.every((k) => folded[k]) && !!folded.docs

  const docs = (
    inSeries
      ? [
          ['bible/timeline.md', 'Timeline (this book)', 'book'],
          [`${prefix}/bible/timeline.md`, 'Series timeline', 'series'],
          [`${prefix}/bible/style-guide.md`, 'Series style guide', 'series']
        ]
      : [
          ['bible/timeline.md', 'Timeline', 'book'],
          ['bible/style-guide.md', 'Style guide', 'book']
        ]
  ).filter(([, label, sc]) => (show === 'all' || sc === show) && (!searching || label.toLowerCase().includes(term)))

  return (
    <div>
      <div className="relative mx-2 mb-2">
        <Search size={13} className="absolute left-2 top-2 text-faint" />
        <input
          className="field w-full pl-7 pr-7 text-[12.5px]"
          placeholder="Search the bible…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQ('')}
        />
        {searching && (
          <button className="absolute right-1.5 top-1.5 rounded p-0.5 text-faint hover:text-fg" title="Clear search" onClick={() => setQ('')}>
            <X size={12} />
          </button>
        )}
      </div>
      <div className="mx-2 mb-2 flex items-center gap-1">
        {inSeries && (
          <div className="flex flex-1 items-center gap-0.5 rounded-md border border-line p-0.5 text-[11.5px]" role="radiogroup" aria-label="Show entries from">
            {(['all', 'series', 'book'] as const).map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={show === v}
                title={v === 'all' ? 'Show every entry' : v === 'series' ? 'Only entries shared by every book in the series' : 'Only entries that belong to this book'}
                className={`flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-0.5 ${
                  show === v ? 'bg-raised text-fg shadow-[var(--shadow-sm)]' : 'text-muted hover:text-fg'
                }`}
                onClick={() => setShow(v)}
              >
                {v === 'all' ? 'All' : v === 'series' ? 'Series' : 'Book'}
                <span className="text-[10.5px] tabular-nums text-faint">{counts[v]}</span>
              </button>
            ))}
          </div>
        )}
        <button
          className={`icon-btn h-[26px] w-[26px] shrink-0 ${inSeries ? '' : 'ml-auto'}`}
          title={allFolded ? 'Expand all sections' : 'Collapse all sections'}
          onClick={() => saveFolded(Object.fromEntries([...kinds, 'docs'].map((k) => [k, !allFolded])))}
        >
          {allFolded ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
        </button>
      </div>
      <div className="mb-2 px-2">
        <button
          className="action-row"
          onClick={async () => {
            const text = await api.commands.expand('bible-sync', 'all')
            if (text) void sendToEngine(text, { display: '/bible-sync all' })
          }}
        >
          <Sparkles size={13} /> Update bible from manuscript
        </button>
      </div>
      {searching && entries.length === 0 && docs.length === 0 && <Empty>Nothing in the bible matches “{q.trim()}”.</Empty>}
      {kinds.map((k) => {
        const list = entries.filter((e) => e.kind === k)
        if (searching && list.length === 0) return null
        const open = isOpen(k)
        const meta = KIND_META[k]
        return (
          <div key={k} className="mb-1">
            <SectionHeader
              open={open}
              onToggle={() => toggle(k)}
              icon={meta.icon}
              label={meta.label}
              count={list.length}
              actions={
                <MiniBtn
                  title={`New ${meta.noun}`}
                  onClick={() => {
                    if (folded[k]) toggle(k)
                    setAdding(k)
                  }}
                >
                  <Plus size={13} />
                </MiniBtn>
              }
            />
            {open && (
              <div className="anim-fade">
                {adding === k && (
                  <div>
                    <InlineInput
                      placeholder={`${meta.noun[0].toUpperCase()}${meta.noun.slice(1)} name`}
                      onCancel={() => setAdding(null)}
                      onSubmit={async (name) => {
                        setAdding(null)
                        const e = await api.bible.upsert(k, name, { aliases: [], summary: '' }, '', scope)
                        openTab({ kind: 'file', path: e.path })
                      }}
                    />
                    {inSeries && (
                      <div className="mx-2 mb-1 flex items-center gap-1 px-1 text-[11px] text-faint">
                        {show === 'all' ? (
                          <>
                            <span>Add to</span>
                            {(['series', 'book'] as const).map((sc) => (
                              <button
                                key={sc}
                                // Keep the name field focused; it cancels when it loses focus.
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setAddScope(sc)}
                                className={`rounded px-1.5 py-px ${addScope === sc ? 'bg-raised text-fg' : 'hover:text-fg'}`}
                              >
                                {sc === 'series' ? 'Series bible' : 'This book'}
                              </button>
                            ))}
                          </>
                        ) : (
                          <span>Adds to {show === 'series' ? 'the series bible' : 'this book'}.</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {list.length === 0 && adding !== k && (
                  <div className="mx-2 py-1 pl-[30px] text-[12px] text-faint">
                    {show === 'all' ? `No ${meta.label.toLowerCase()} yet.` : `No ${show} ${meta.label.toLowerCase()}.`}
                  </div>
                )}
                {list.map((e) => (
                  <Row
                    key={e.path}
                    indent={1}
                    active={activePath === e.path}
                    title={e.summary}
                    onClick={() => openTab({ kind: 'file', path: e.path })}
                    actions={
                      k === 'characters' ? (
                        <MiniBtn
                          title="Develop with AI"
                          onClick={async () => {
                            const text = await api.commands.expand('character', e.name)
                            if (text) void sendToEngine(text, { display: `/character ${e.name}` })
                          }}
                        >
                          <Sparkles size={13} />
                        </MiniBtn>
                      ) : undefined
                    }
                  >
                    <span className="truncate">{e.name}</span>
                    {inSeries && show === 'all' && (
                      <span
                        className={`ml-1 shrink-0 rounded px-1 text-[10px] group-hover:hidden ${e.scope === 'series' ? 'bg-accent/15 text-accent' : 'bg-line text-faint'}`}
                        title={e.scope === 'series' ? 'Shared by every book in the series' : 'Only in this book'}
                      >
                        {e.scope === 'series' ? 'series' : 'book'}
                      </span>
                    )}
                  </Row>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {docs.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          <SectionHeader open={isOpen('docs')} onToggle={() => toggle('docs')} icon={<FileText size={13} />} label="Documents" />
          {isOpen('docs') &&
            docs.map(([p, label]) => (
              <Row key={p} indent={1} active={activePath === p} onClick={() => openTab({ kind: 'file', path: p })}>
                <span className="truncate">{label}</span>
              </Row>
            ))}
        </div>
      )}
    </div>
  )
}

// ---------------- outline ----------------

function OutlinePanel() {
  const project = useStore((s) => s.project)!
  const openTab = useStore((s) => s.openTab)
  const sendToEngine = useStore((s) => s.sendToEngine)
  const activePath = useActivePath()
  const files = project.files.filter((f) => f.startsWith('outline/') || f.startsWith('notes/') || f === 'NOVEL.md')
  const run = async (name: string, args = '') => {
    const text = await api.commands.expand(name, args)
    if (text) void sendToEngine(text, { display: `/${name} ${args}`.trim() })
  }
  return (
    <div>
      {files.map((f) => (
        <Row key={f} active={activePath === f} onClick={() => openTab({ kind: 'file', path: f })}>
          <FileText size={13} />
          <span className="truncate">{f === 'NOVEL.md' ? "Author's instructions" : docTitle(project, f)}</span>
          {f.startsWith('notes/') && <span className="ml-auto pr-1 text-[11px] text-faint">Notes</span>}
        </Row>
      ))}
      <div className="mt-3 border-t border-line px-2 pt-3">
        <div className="mb-1 px-2.5 text-[11.5px] font-medium text-faint">With the AI</div>
        <button className="action-row" onClick={() => void run('outline')}>
          <Sparkles size={13} /> Develop outline with AI
        </button>
        <button className="action-row" onClick={() => void run('beats')}>
          <Sparkles size={13} /> Fill in beat sheet
        </button>
        <button className="action-row" onClick={() => void run('summarize', 'all scenes missing a summary')}>
          <Sparkles size={13} /> Summarise scenes
        </button>
        <button className="action-row" onClick={() => openTab({ kind: 'corkboard' })}>
          <LayoutGrid size={13} /> Corkboard
        </button>
      </div>
    </div>
  )
}

// ---------------- files ----------------

function FilesPanel() {
  const project = useStore((s) => s.project)!
  const openTab = useStore((s) => s.openTab)
  const activePath = useActivePath()
  const groups = useMemo(() => {
    const g: Record<string, string[]> = {}
    for (const f of [...project.files, ...(project.series?.files ?? [])]) {
      const d = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.'
      ;(g[d] ??= []).push(f)
    }
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b))
  }, [project.files, project.series])
  return (
    <div>
      {groups.map(([dir, files]) => (
        <div key={dir} className="mb-1">
          <div className="px-3 py-0.5 text-[11px] text-faint">{dir === '.' ? 'project root' : dir}</div>
          {files.map((f) => (
            <Row key={f} indent={1} active={activePath === f} onClick={() => (/\.(md|txt|json|csv)$/i.test(f) ? openTab({ kind: 'file', path: f }) : void api.app.openPath(f))}>
              <FileText size={12} />
              <span className="truncate">{f.split('/').pop()}</span>
            </Row>
          ))}
        </div>
      ))}
    </div>
  )
}

// ---------------- conversations ----------------

function HistoryPanel() {
  const sessions = useStore((s) => s.sessions)
  const current = useStore((s) => s.session.id)
  const resumeChat = useStore((s) => s.resumeChat)
  const newChat = useStore((s) => s.newChat)
  const refresh = useStore((s) => s.refreshSessions)
  return (
    <div>
      <div className="mb-1 px-2">
        <button className="btn w-full justify-center py-1 text-[12px]" onClick={() => void newChat()}>
          <Plus size={13} /> New conversation
        </button>
      </div>
      {sessions.length === 0 && <Empty>No past conversations yet.</Empty>}
      {sessions.map((s) => (
        <Row
          key={s.id}
          active={s.id === current}
          onClick={() => void resumeChat(s.id)}
          actions={
            <MiniBtn
              title="Delete"
              onClick={async () => {
                await api.sessions.delete(s.id)
                void refresh()
              }}
            >
              <Trash2 size={12} />
            </MiniBtn>
          }
        >
          <EngineDot engine={s.engine} size={7} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[12.5px]">{s.title}</span>
            <span className="text-[11px] text-faint">{timeAgo(s.updated)}</span>
          </span>
        </Row>
      ))}
    </div>
  )
}

// ---------------- snapshots ----------------

function SnapshotsPanel() {
  const project = useStore((s) => s.project)
  const notify = useStore((s) => s.notify)
  const [snaps, setSnaps] = useState<Snapshot[]>([])
  const [adding, setAdding] = useState(false)
  const load = () => api.snapshots.list().then(setSnaps)
  useEffect(() => {
    void load()
  }, [project?.totalWords])
  return (
    <div>
      <div className="mb-1 px-2">
        <button className="btn w-full justify-center py-1 text-[12px]" onClick={() => setAdding(true)}>
          <Camera size={13} /> Take snapshot
        </button>
      </div>
      {adding && (
        <InlineInput
          placeholder="Describe this snapshot"
          onCancel={() => setAdding(false)}
          onSubmit={async (m) => {
            setAdding(false)
            const r = await api.snapshots.create(m)
            notify(r ? 'Snapshot saved.' : 'No changes since the last snapshot.')
            void load()
          }}
        />
      )}
      <p className="px-3 pb-2 text-[11.5px] text-faint">Snapshots are taken before AI edits, so you can always rewind the whole project.</p>
      {snaps.map((s) => (
        <Row
          key={s.oid}
          actions={
            <MiniBtn
              title="Rewind to this snapshot"
              onClick={async () => {
                if (!confirm(`Rewind the whole project to "${s.message}"?\nYour current state is saved as a snapshot first.`)) return
                await api.snapshots.restore(s.oid)
                notify('Project rewound.')
                void load()
              }}
            >
              <RotateCcw size={13} />
            </MiniBtn>
          }
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[12.5px]">{s.message}</span>
            <span className="text-[11px] text-faint">
              {new Date(s.timestamp).toLocaleString()} · {s.oid.slice(0, 7)}
            </span>
          </span>
        </Row>
      ))}
    </div>
  )
}

// ---------------- reports ----------------

function ReportsPanel() {
  const project = useStore((s) => s.project)
  const openTab = useStore((s) => s.openTab)
  const sendToEngine = useStore((s) => s.sendToEngine)
  const activePath = useActivePath()
  const [reports, setReports] = useState<{ path: string; name: string; mtime: number }[]>([])
  useEffect(() => {
    void api.reports.list().then(setReports)
  }, [project?.files.length, project?.totalWords])
  const run = async (name: string, args: string) => {
    const text = await api.commands.expand(name, args)
    if (text) void sendToEngine(text, { display: `/${name} ${args}` })
  }
  return (
    <div>
      <div className="mb-2 border-b border-line px-2 pb-2">
        <button className="action-row" onClick={() => void run('continuity', 'all')}>
          <ShieldCheck size={13} /> Continuity check (whole book)
        </button>
        <button className="action-row" onClick={() => void run('critique', 'the whole manuscript so far')}>
          <Sparkles size={13} /> Developmental critique
        </button>
      </div>
      {reports.length === 0 && <Empty>Continuity checks and critiques will appear here.</Empty>}
      {reports.map((r) => (
        <Row key={r.path} active={activePath === r.path} onClick={() => openTab({ kind: 'file', path: r.path })}>
          <FileWarning size={13} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[12.5px]">{r.name}</span>
            <span className="text-[11px] text-faint">{timeAgo(r.mtime)}</span>
          </span>
        </Row>
      ))}
    </div>
  )
}
