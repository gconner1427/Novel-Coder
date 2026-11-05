import { useEffect, useState } from 'react'
import { ArrowLeft, BookPlus, Lightbulb, Pencil, Eye, Library, BookOpen } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../store'
import { ChatPane } from './chat/ChatPane'
import { Markdown } from './chat/Messages'

/** Chat with an engine before a project exists. ideas.md (kept up to date by the AI) shows on the right. */
export function BrainstormView() {
  const b = useStore((s) => s.brainstorm)!
  const set = useStore((s) => s.set)
  const leave = useStore((s) => s.leaveBrainstorm)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(b.ideas)

  useEffect(() => {
    if (!editing) setDraft(b.ideas)
  }, [b.ideas, editing])

  const f = b.fields
  const chips = [
    f.title && { label: f.title, strong: true },
    { label: f.series ? `Series · ${f.plannedBooks ?? '?'} books` : 'Standalone novel', icon: f.series ? <Library size={11} /> : <BookOpen size={11} /> },
    f.genre && { label: f.genre },
    f.pov && { label: f.pov },
    f.tense && { label: `${f.tense} tense` }
  ].filter(Boolean) as { label: string; strong?: boolean; icon?: React.ReactNode }[]

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col bg-panel">
        <ChatPane wide />
      </section>
      <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-bg">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <button className="icon-btn" title="Back to start" onClick={() => void leave()}>
            <ArrowLeft size={15} />
          </button>
          <Lightbulb size={14} className="text-accent" />
          <span className="text-[13px] font-semibold">Ideas</span>
          <span className="text-[11.5px] text-faint">kept up to date by the AI</span>
          <div className="flex-1" />
          <button
            className="icon-btn"
            title={editing ? 'Preview' : 'Edit ideas.md yourself'}
            onClick={async () => {
              if (editing) await api.brainstorm.writeIdeas(b.id, draft)
              setEditing(!editing)
            }}
          >
            {editing ? <Eye size={14} /> : <Pencil size={14} />}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
          {chips.map((c, i) => (
            <span key={i} className={`flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11.5px] ${c.strong ? 'font-semibold text-fg' : 'text-muted'}`}>
              {c.icon}
              {c.label}
            </span>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {editing ? (
            <textarea
              className="h-full min-h-[60vh] w-full resize-none rounded-md border border-line bg-panel p-3 font-[var(--font-code)] text-[12.5px] outline-none"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void api.brainstorm.writeIdeas(b.id, draft)}
            />
          ) : (
            <div className="text-[13px]">
              <Markdown text={b.ideas.replace(/<!--[\s\S]*?-->/g, '')} />
            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-line p-3">
          <button className="btn btn-primary w-full justify-center py-2" onClick={() => set({ dialog: 'convert' })}>
            <BookPlus size={15} /> Turn into a {f.series ? 'series' : 'book'}
          </button>
          <p className="mt-2 text-center text-[11.5px] text-faint">
            Creates the Novel Coder project. The AI then builds the outline, story bible and first scenes from this conversation.
          </p>
        </div>
      </aside>
    </div>
  )
}
