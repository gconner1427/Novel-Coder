import { useEffect, useState } from 'react'
import { FolderOpen, Plus, Lightbulb, Trash2, X, LogIn, Feather } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../store'
import type { EngineId, ShelfBook } from '@shared/types'
import { EngineDot, ENGINE_LABEL, timeAgo } from './ui'

/** Book-cloth colours. A book always gets the same one, picked from its title. */
const CLOTH = ['#5b2026', '#1f3b2f', '#1c2b4b', '#3e2242', '#2c3542', '#4b3121', '#173e40', '#26243d']

function clothFor(title: string): string {
  let h = 0
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return CLOTH[h % CLOTH.length]
}

/** A generated cloth-bound cover: spine shadow, a soft lamp highlight and brass-foil lettering. */
function Cover({ book }: { book: Pick<ShelfBook, 'title' | 'author' | 'seriesTitle' | 'seriesNumber'> }) {
  const cloth = clothFor(book.title)
  // Fit the foil lettering to the cover: long words get a smaller size so they stay inside the frame.
  const longest = Math.max(...book.title.split(/\s+/).map((w) => w.length))
  const size = longest > 11 ? 13.5 : longest > 8 ? 15 : 17
  return (
    <div
      className="relative flex aspect-[2/3] w-full flex-col items-center overflow-hidden rounded-[3px_7px_7px_3px] pb-4 pl-[22px] pr-4 pt-7 text-center"
      style={{
        background: [
          'linear-gradient(90deg, rgba(0,0,0,.45) 0, rgba(0,0,0,.1) 5%, rgba(255,255,255,.07) 6.5%, transparent 9%)',
          'radial-gradient(120% 70% at 35% -10%, rgba(255,255,255,.13), transparent 60%)',
          'repeating-linear-gradient(45deg, rgba(255,255,255,.012) 0 2px, transparent 2px 4px)',
          cloth
        ].join(','),
        boxShadow: '0 1px 0 rgba(255,255,255,.08) inset, 0 18px 30px -14px rgba(0,0,0,.65), 0 4px 10px -4px rgba(0,0,0,.4)'
      }}
    >
      <span className="pointer-events-none absolute inset-[9px] left-[14px] rounded-[2px] border" style={{ borderColor: 'rgba(222,186,115,.32)' }} />
      {book.seriesTitle && (
        <span className="mb-2 line-clamp-2 text-balance text-[9.5px] font-medium leading-snug tracking-[0.04em]" style={{ color: 'rgba(230,200,140,.7)' }}>
          {book.seriesTitle}
          {book.seriesNumber ? `, book ${book.seriesNumber}` : ''}
        </span>
      )}
      <span className="mt-2 text-balance break-words font-semibold leading-[1.18]" style={{ fontSize: size, maxWidth: '100%', fontFamily: 'var(--font-prose)', color: '#e6c482', textShadow: '0 1px 0 rgba(0,0,0,.35)' }}>
        {book.title}
      </span>
      <span className="my-3 h-px w-8" style={{ background: 'rgba(222,186,115,.5)' }} />
      <span className="mt-auto line-clamp-1 text-[10.5px]" style={{ color: 'rgba(230,200,140,.75)' }}>
        {book.author}
      </span>
    </div>
  )
}

function BookTile({ book, onOpen, onRemove }: { book: ShelfBook; onOpen: () => void; onRemove: () => void }) {
  const pct = book.targetWords ? Math.min(100, Math.round((book.words / book.targetWords) * 100)) : 0
  return (
    <div className="group relative">
      <button
        className={`block w-full rounded-[3px_7px_7px_3px] transition-transform duration-200 ${book.exists ? 'hover:-translate-y-1' : 'opacity-40 grayscale'}`}
        title={book.exists ? `Open ${book.title}\n${book.root}` : `Folder not found: ${book.root}`}
        disabled={!book.exists}
        onClick={onOpen}
      >
        <Cover book={book} />
      </button>
      <button
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white/80 opacity-0 backdrop-blur hover:text-white group-hover:opacity-100"
        title="Remove from this list (the book's folder is not touched)"
        onClick={onRemove}
      >
        <X size={12} />
      </button>
      <div className="mt-3 min-w-0">
        <div className="truncate text-[13px] font-medium">{book.title}</div>
        {book.exists ? (
          <>
            <div className="mt-0.5 text-[11.5px] tabular-nums text-faint">
              {book.words.toLocaleString()} {book.words === 1 ? 'word' : 'words'}
              {book.genre ? ` in ${book.genre.toLowerCase()}` : ''}
            </div>
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-line-strong" title={`${pct}% of ${book.targetWords.toLocaleString()} words`}>
              <div className="h-full rounded-full bg-accent/80" style={{ width: `${Math.max(pct, book.words ? 2 : 0)}%` }} />
            </div>
          </>
        ) : (
          <div className="mt-0.5 text-[11.5px] text-warn">Folder not found</div>
        )}
      </div>
    </div>
  )
}

export function Welcome() {
  const settings = useStore((s) => s.settings)
  const auth = useStore((s) => s.auth)
  const set = useStore((s) => s.set)
  const loadProject = useStore((s) => s.loadProject)
  const notify = useStore((s) => s.notify)
  const brainstorms = useStore((s) => s.brainstorms)
  const startBrainstorm = useStore((s) => s.startBrainstorm)
  const openBrainstorm = useStore((s) => s.openBrainstorm)
  const refreshBrainstorms = useStore((s) => s.refreshBrainstorms)
  const [shelf, setShelf] = useState<ShelfBook[] | null>(null)

  useEffect(() => {
    void api.project.shelf().then(setShelf)
  }, [settings?.recent])

  const open = async (dir?: string | null) => {
    dir = dir ?? (await api.app.pickFolder('Open a novel project folder'))
    if (!dir) return
    try {
      await loadProject(await api.project.open(dir))
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }
  const remove = async (dir: string) => set({ settings: await api.app.setSettings({ recent: (settings?.recent ?? []).filter((r) => r !== dir) }) })
  const brainstorm = (e: EngineId) => void startBrainstorm(e).catch((err) => notify((err as Error).message, 'error'))

  if (!shelf) return <div className="desk flex-1" />
  const books = shelf
  const found = books.filter((b) => b.exists)
  const total = found.reduce((a, b) => a + b.words, 0)
  const empty = books.length === 0

  const brainstormButtons = (
    <div className="flex flex-wrap gap-2">
      {(['claude', 'codex'] as EngineId[]).map((e) => (
        <button key={e} className="btn" onClick={() => brainstorm(e)}>
          <EngineDot engine={e} size={7} /> Brainstorm with {ENGINE_LABEL[e]}
        </button>
      ))}
    </div>
  )

  return (
    <div className="desk flex-1 overflow-y-auto">
      <div className="anim-fade mx-auto w-full max-w-[1040px] px-10 pb-12 pt-14">
        {empty ? (
          <div className="mx-auto max-w-[620px] pt-6 text-center">
            <span className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-line-strong bg-raised" style={{ boxShadow: 'var(--shadow-md), 0 0 50px -6px var(--lamp)' }}>
              <Feather size={24} className="text-accent" />
            </span>
            <h1 className="mb-3 text-[36px] font-semibold leading-tight tracking-[-0.015em]" style={{ fontFamily: 'var(--font-prose)' }}>
              Start your first book
            </h1>
            <p className="mx-auto mb-9 max-w-[480px] text-[14px] leading-relaxed text-muted">
              Talk an idea through with an AI until it clicks, or set up a book with a story bible, an outline and a manuscript and start writing.
            </p>
            <div className="grid grid-cols-2 gap-3 text-left">
              <div className="rounded-2xl border border-line-strong bg-panel p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
                <Lightbulb size={18} className="mb-3 text-accent" />
                <div className="mb-1 font-semibold">Brainstorm first</div>
                <p className="mb-4 text-[12.5px] leading-relaxed text-faint">Premise, characters, world, standalone or series. Turn it into a book with one click when you're ready.</p>
                {brainstormButtons}
              </div>
              <div className="flex flex-col rounded-2xl border border-line-strong bg-panel p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
                <Plus size={18} className="mb-3 text-accent" />
                <div className="mb-1 font-semibold">I know what I'm writing</div>
                <p className="mb-4 text-[12.5px] leading-relaxed text-faint">Start a new novel or series, or open a Novel Coder folder you already have.</p>
                <div className="mt-auto flex flex-wrap gap-2">
                  <button className="btn btn-primary" onClick={() => set({ dialog: 'new' })}>
                    <Plus size={14} /> New novel or series
                  </button>
                  <button className="btn" onClick={() => void open()}>
                    <FolderOpen size={14} /> Open novel
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-10 flex flex-wrap items-end gap-4">
              <div className="min-w-0 flex-1">
                <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.015em]" style={{ fontFamily: 'var(--font-prose)' }}>
                  Your library
                </h1>
                <p className="mt-1 text-[13px] text-faint">
                  {found.length} {found.length === 1 ? 'book' : 'books'}, {total.toLocaleString()} words written
                </p>
              </div>
              <button className="btn" onClick={() => void open()}>
                <FolderOpen size={14} /> Open novel
              </button>
              <button className="btn btn-primary" onClick={() => set({ dialog: 'new' })}>
                <Plus size={14} /> New novel or series
              </button>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-x-6 gap-y-9">
              {books.map((b) => (
                <BookTile key={b.root} book={b} onOpen={() => void open(b.root)} onRemove={() => void remove(b.root)} />
              ))}
              <button
                className="group flex aspect-[2/3] flex-col items-center justify-center gap-2 rounded-[3px_7px_7px_3px] border border-dashed border-line-strong text-faint transition-colors hover:border-accent/60 hover:bg-accent/[0.04] hover:text-accent"
                onClick={() => set({ dialog: 'new' })}
              >
                <Plus size={20} />
                <span className="text-[12.5px]">Start a new book</span>
              </button>
            </div>

            <div className="mt-14 grid gap-8 md:grid-cols-[1fr_1.3fr]">
              <div>
                <h2 className="mb-1 text-[15px] font-semibold">Not sure what's next?</h2>
                <p className="mb-4 text-[12.5px] leading-relaxed text-faint">Brainstorm with an AI. It keeps notes as you talk, and when the idea clicks you turn it into a book or series with one click.</p>
                {brainstormButtons}
              </div>
              {brainstorms.length > 0 && (
                <div>
                  <h2 className="mb-3 text-[15px] font-semibold">Ideas in progress</h2>
                  <BrainstormList brainstorms={brainstorms} open={(id) => void openBrainstorm(id)} refresh={() => void refreshBrainstorms()} />
                </div>
              )}
            </div>
          </>
        )}

        {empty && brainstorms.length > 0 && (
          <div className="mx-auto mt-12 max-w-[620px]">
            <h2 className="mb-3 text-[15px] font-semibold">Ideas in progress</h2>
            <BrainstormList brainstorms={brainstorms} open={(id) => void openBrainstorm(id)} refresh={() => void refreshBrainstorms()} />
          </div>
        )}

        {/* Accounts: a quiet status line, loud only when something needs doing. */}
        <div className={`mt-16 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-5 text-[12px] text-faint ${empty ? 'mx-auto max-w-[620px] justify-center' : ''}`}>
          {(['claude', 'codex'] as EngineId[]).map((e) => {
            const a = auth?.[e]
            const ok = a?.loggedIn
            return (
              <span key={e} className="flex items-center gap-2">
                <EngineDot engine={e} size={6} />
                <span className={ok ? '' : 'text-warn'}>{!a ? `${ENGINE_LABEL[e]}: checking…` : ok ? `${ENGINE_LABEL[e]} is signed in` : a.installed ? `${ENGINE_LABEL[e]} isn't signed in` : 'Claude Code isn’t installed'}</span>
                {a && !ok && (
                  <button
                    className="flex items-center gap-1 font-medium text-accent hover:underline"
                    onClick={async () => {
                      if (!a.installed) return void api.app.openExternal('https://code.claude.com/docs/en/setup')
                      await api.auth.login(e)
                      notify('Finish signing in in the window that opened, then click Refresh.')
                    }}
                  >
                    <LogIn size={12} /> {a.installed ? 'Sign in' : 'Install'}
                  </button>
                )}
              </span>
            )
          })}
          <button className="hover:text-muted" onClick={async () => set({ auth: await api.auth.status() })}>
            Refresh
          </button>
          <button className="hover:text-muted" onClick={() => set({ dialog: 'settings' })}>
            Manage accounts
          </button>
        </div>
      </div>
    </div>
  )
}

function BrainstormList({ brainstorms, open, refresh }: { brainstorms: ReturnType<typeof useStore.getState>['brainstorms']; open: (id: string) => void; refresh: () => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      {brainstorms.slice(0, 6).map((b) => (
        <div key={b.id} className="group flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0 hover:bg-panel2">
          <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => open(b.id)}>
            <Lightbulb size={14} className="shrink-0 text-accent/70" />
            <span className="truncate text-[13px] font-medium">{b.title}</span>
            <EngineDot engine={b.engine} size={6} />
            <span className="ml-auto shrink-0 text-[11.5px] text-faint">{timeAgo(b.updated)}</span>
          </button>
          <button
            className="hidden text-faint hover:text-err group-hover:block"
            title="Delete brainstorm"
            onClick={async () => {
              if (!confirm(`Delete the brainstorm "${b.title}"?`)) return
              await window.novel.brainstorm.delete(b.id)
              refresh()
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
