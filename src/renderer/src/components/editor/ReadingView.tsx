import { memo, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BookOpen, ChevronLeft, ChevronRight, FileDown, List, Pencil, Type } from 'lucide-react'
import { api } from '../../lib/api'
import { useStore, tabKey, type Tab } from '../../store'
import { Dropdown } from '../ui'
import type { ManuscriptText } from '@shared/types'

/** One scene's prose, set as book text. Memoised so a long manuscript only re-renders scenes that changed. */
const SceneProse = memo(function SceneProse({ body }: { body: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
})

const readingTime = (words: number) => {
  const m = Math.max(1, Math.round(words / 250))
  return m < 60 ? `${m} min read` : `${Math.floor(m / 60)} hr ${m % 60} min read`
}

/** Read a whole chapter, or the whole manuscript, as one continuous text. Read-only; double-click a passage to edit its scene. */
export function ReadingView({ chapter }: { chapter?: string }) {
  const project = useStore((s) => s.project)!
  const settings = useStore((s) => s.settings)
  const openTab = useStore((s) => s.openTab)
  const set = useStore((s) => s.set)
  const [text, setText] = useState<ManuscriptText | null>(null)
  const [titles, setTitles] = useState(() => localStorage.getItem('novelcoder.readSceneTitles') === '1')
  const [progress, setProgress] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const indent = typeof localStorage !== 'undefined' && localStorage.getItem('novelcoder.indent') === '1'

  // Reload whenever the book changes (your edits, or the AI's), keeping the reading position.
  useEffect(() => {
    let alive = true
    void api.project.readManuscript(chapter).then((t) => alive && setText(t))
    return () => {
      alive = false
    }
  }, [chapter, project])

  // Back to the top when moving to another chapter.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [chapter])

  const whole = !chapter
  const chapters = text?.chapters ?? []
  const words = chapters.reduce((a, c) => a + c.words, 0)
  const order = project.chapters.map((c) => c.folder)
  const idx = chapter ? order.indexOf(chapter) : -1
  const prev = idx > 0 ? project.chapters[idx - 1] : null
  const next = idx >= 0 && idx < order.length - 1 ? project.chapters[idx + 1] : null
  const heading = whole ? 'Whole manuscript' : (chapters[0]?.title ?? project.chapters[idx]?.title ?? 'Chapter')
  const fontVar = settings?.editorFont === 'sans' ? 'var(--font-ui)' : settings?.editorFont === 'mono' ? 'var(--font-code)' : 'var(--font-prose)'
  const empty = text && chapters.every((c) => c.scenes.length === 0)

  /** Move this tab to another chapter (or the whole manuscript) instead of opening a new tab for each. */
  const goTo = (t: Tab) => {
    const st = useStore.getState()
    const here = tabKey({ kind: 'read', chapter })
    const there = tabKey(t)
    if (st.tabs.some((x) => tabKey(x) === there)) return st.set({ active: there, tabs: st.tabs.filter((x) => tabKey(x) !== here) })
    st.set({ tabs: st.tabs.map((x) => (tabKey(x) === here ? t : x)), active: there })
  }

  const toggleTitles = () => {
    localStorage.setItem('novelcoder.readSceneTitles', titles ? '0' : '1')
    setTitles(!titles)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-panel/60 px-4 py-1.5">
        <BookOpen size={14} className="text-accent" />
        <span className="text-[13px] font-medium">{heading}</span>
        <span className="text-[12px] tabular-nums text-faint">
          {words.toLocaleString()} words, {readingTime(words)}
        </span>
        <div className="flex-1" />
        {whole && chapters.length > 1 && (
          <Dropdown<string>
            value=""
            align="right"
            label={
              <span className="flex items-center gap-1.5">
                <List size={13} /> Contents
              </span>
            }
            options={chapters.map((c) => ({ value: c.folder, label: c.title, hint: `${c.words.toLocaleString()} words` }))}
            onChange={(f) => document.getElementById(`read-${f}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />
        )}
        <button className={`icon-btn h-7 w-7 ${titles ? 'bg-panel2 text-accent' : ''}`} title="Show where each scene starts" aria-pressed={titles} onClick={toggleTitles}>
          <Type size={14} />
        </button>
        <button className="icon-btn h-7 w-7" title="Export the manuscript (Ctrl+Shift+E)" onClick={() => set({ dialog: 'export' })}>
          <FileDown size={14} />
        </button>
      </div>
      <div className="relative h-[2px] shrink-0 bg-transparent">
        <div className="absolute inset-y-0 left-0 bg-accent/70 transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
      </div>

      <div
        ref={scroller}
        data-testid="reading-view"
        className="desk min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget
          const max = el.scrollHeight - el.clientHeight
          setProgress(max > 0 ? el.scrollTop / max : 0)
        }}
      >
        <div className="mx-auto px-10 pb-[30vh] pt-16" style={{ maxWidth: (settings?.editorWidth ?? 720) + 80, ['--prose-font' as string]: fontVar }}>
          {whole && text && (
            <header className="mb-20 text-center">
              <h1 className="mb-3 text-balance text-[40px] font-semibold leading-tight tracking-[-0.015em]" style={{ fontFamily: 'var(--font-prose)' }}>
                {text.title}
              </h1>
              {text.author && <p className="text-[15px] italic text-muted" style={{ fontFamily: 'var(--font-prose)' }}>by {text.author}</p>}
              <div className="mx-auto mt-8 h-px w-16 bg-accent/50" />
            </header>
          )}

          {empty && (
            <div className="py-20 text-center text-[13px] text-faint">
              {whole ? 'Nothing written yet.' : 'Nothing written in this chapter yet.'} Scenes appear here as you write them.
            </div>
          )}

          {chapters.map((c) => (
            <section key={c.folder} id={`read-${c.folder}`} className={`scroll-mt-6 ${whole ? 'mb-24' : ''}`}>
              <h2 className="mb-12 text-center text-[28px] font-semibold tracking-[-0.01em]" style={{ fontFamily: 'var(--font-prose)' }}>
                {c.title}
              </h2>
              {whole && c.scenes.length === 0 && <p className="text-center text-[13px] italic text-faint">Not written yet.</p>}
              {c.scenes.map((s, i) => (
                <div key={s.path}>
                  {i > 0 && (
                    <div className="my-8 text-center text-faint" aria-label="Scene break" style={{ letterSpacing: '0.5em' }}>
                      * * *
                    </div>
                  )}
                  <article
                    className="group relative cursor-text"
                    title={`${s.title}: double-click to edit this scene`}
                    onDoubleClick={() => openTab({ kind: 'file', path: s.path })}
                  >
                    <span className="pointer-events-none absolute -left-5 bottom-1 top-1 w-px bg-accent/0 transition-colors group-hover:bg-accent/40" />
                    {titles && (
                      <button
                        className="mb-3 flex items-center gap-1.5 rounded-md text-[11.5px] text-faint hover:text-accent"
                        onClick={() => openTab({ kind: 'file', path: s.path })}
                      >
                        <Pencil size={11} /> {s.title}
                      </button>
                    )}
                    <div className={`reading ${indent ? 'indent' : ''}`}>
                      <SceneProse body={s.body} />
                    </div>
                  </article>
                </div>
              ))}
            </section>
          ))}

          {!whole && text && (
            <nav className="mt-20 flex items-center justify-between gap-4 border-t border-line pt-6 text-[13px]" aria-label="Chapters">
              {prev ? (
                <button className="flex min-w-0 items-center gap-1.5 text-muted hover:text-fg" onClick={() => goTo({ kind: 'read', chapter: prev.folder })}>
                  <ChevronLeft size={15} className="shrink-0" />
                  <span className="truncate">{prev.title}</span>
                </button>
              ) : (
                <span />
              )}
              <button className="text-faint hover:text-muted" onClick={() => goTo({ kind: 'read' })}>
                Whole manuscript
              </button>
              {next ? (
                <button className="flex min-w-0 items-center gap-1.5 text-muted hover:text-fg" onClick={() => goTo({ kind: 'read', chapter: next.folder })}>
                  <span className="truncate">{next.title}</span>
                  <ChevronRight size={15} className="shrink-0" />
                </button>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  )
}
