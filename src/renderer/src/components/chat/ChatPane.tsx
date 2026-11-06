import { useEffect, useRef, useState } from 'react'
import { SquarePen, History, ListChecks, CheckCircle2, Circle, CircleDot, Feather, ChevronDown, ChevronUp } from 'lucide-react'
import { useStore } from '../../store'
import { MessageList } from './Messages'
import { Composer } from './Composer'
import { Dropdown, EngineDot, ENGINE_LABEL, timeAgo } from '../ui'
import type { EngineId } from '@shared/types'

const STARTERS = [
  { label: 'Get to know this book', text: 'Read the project overview, outline and story bible, then tell me what you understand about this novel so far and what you think is missing.' },
  { label: 'Brainstorm the premise', text: '/brainstorm premises and hooks that fit the genre and outline' },
  { label: 'Draft the next scene', text: '/draft the next scene that needs writing according to the outline' },
  { label: 'Continuity check', text: '/continuity all' }
]

const BRAINSTORM_STARTERS = [
  { label: 'I have a vague idea…', text: "I have a vague idea for a book but it isn't fully formed. Ask me a few questions to draw it out." },
  { label: 'Help me find a premise', text: 'I want to write a novel but have no idea yet. Help me find a premise: ask about what I love to read, then pitch me several very different high-concept ideas.' },
  { label: 'Plan a series', text: "I'm thinking of writing a series. Help me work out the big arc, how many books, and what each book is about." },
  { label: 'Start from a character', text: 'I have a character in my head but no plot yet. Help me build a story around them.' }
]

export function ChatPane({ wide }: { wide: boolean }) {
  const session = useStore((s) => s.session)
  const engine = useStore((s) => s.engine)
  const busy = useStore((s) => s.busy)
  const todos = useStore((s) => s.todos)
  const sessions = useStore((s) => s.sessions)
  const project = useStore((s) => s.project)
  const newChat = useStore((s) => s.newChat)
  const resumeChat = useStore((s) => s.resumeChat)
  const switchEngine = useStore((s) => s.switchEngine)
  const sendToEngine = useStore((s) => s.sendToEngine)
  const set = useStore((s) => s.set)
  const brainstorm = useStore((s) => s.brainstorm)
  const starters = brainstorm ? BRAINSTORM_STARTERS : STARTERS
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [todosOpen, setTodosOpen] = useState(true)

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [session.items, busy])

  const empty = session.items.length === 0
  const doneCount = todos.filter((t) => t.status === 'completed').length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        <Dropdown<EngineId>
          value={engine}
          onChange={(e) => void switchEngine(e)}
          options={[
            { value: 'claude', label: 'Claude', hint: 'Claude Code engine · your Claude subscription', icon: <EngineDot engine="claude" /> },
            { value: 'codex', label: 'Codex', hint: 'OpenAI Codex engine · your ChatGPT subscription', icon: <EngineDot engine="codex" /> }
          ]}
        />
        <span className="min-w-0 flex-1 truncate px-1 text-[12.5px] text-muted" title={session.title}>
          {session.title}
        </span>
        <Dropdown<string>
          value={session.id}
          align="right"
          label={<History size={14} />}
          onChange={(id) => void resumeChat(id)}
          options={sessions.slice(0, 20).map((s) => ({ value: s.id, label: s.title, hint: `${ENGINE_LABEL[s.engine]} · ${timeAgo(s.updated)}` }))}
        />
        <button className="icon-btn" title="New conversation (Ctrl+Shift+N)" onClick={() => void newChat()}>
          <SquarePen size={15} />
        </button>
      </div>

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-2"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        <div className={wide ? 'mx-auto max-w-[820px]' : ''}>
          {empty ? (
            <div className="anim-fade flex flex-col items-center px-4 pt-20 text-center">
              <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-line-strong bg-raised" style={{ boxShadow: 'var(--shadow-md), 0 0 40px -6px var(--lamp)' }}>
                <Feather size={22} className="text-accent" />
              </span>
              <h2 className="mb-1.5 text-[21px] font-semibold tracking-[-0.01em]" style={{ fontFamily: 'var(--font-prose)' }}>{brainstorm ? "Let's find your story" : 'What are we writing today?'}</h2>
              <p className="mb-7 max-w-[360px] text-[12.5px] leading-relaxed text-faint">
                {brainstorm ? (
                  <>
                    Brainstorm freely with {ENGINE_LABEL[engine]}. It keeps notes in <b>Ideas</b> on the right. When you're ready, click <b>Turn into a book</b> and everything carries over.
                  </>
                ) : (
                  <>
                    {ENGINE_LABEL[engine]} can read and edit your whole project: manuscript, story bible and outline{project?.series ? ', plus the series bible and earlier books' : ''}. Type <code>/</code> for writing commands and <code>@</code> to mention a file.
                  </>
                )}
              </p>
              <div className="w-full max-w-[360px] overflow-hidden rounded-xl border border-line bg-panel2/60">
                {starters.map((s, i) => (
                  <button
                    key={s.label}
                    className={`group flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13px] text-muted hover:bg-raised hover:text-fg ${i ? 'border-t border-line' : ''}`}
                    onClick={() => (s.text.startsWith('/') ? set({ draft: s.text }) : void sendToEngine(s.text))}
                  >
                    <span className="flex-1">{s.label}</span>
                    <span className="text-[11px] text-faint opacity-0 transition-opacity group-hover:opacity-100">{s.text.startsWith('/') ? 'Fill in' : 'Ask'}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <MessageList items={session.items} />
          )}
          {busy && (
            <div data-busy className="anim-fade my-3 flex items-center gap-2.5 text-[12.5px]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-50" />
                <span className="relative h-2 w-2 rounded-full bg-accent" />
              </span>
              <span className="shimmer font-medium">Working…</span>
              <span className="text-[11.5px] text-faint">
                <kbd className="rounded border border-b-2 border-line-strong px-1 font-[var(--font-ui)] text-[10.5px]">Esc</kbd> to stop
              </span>
            </div>
          )}
        </div>
      </div>

      {todos.length > 0 && (
        <div className={`shrink-0 px-3 pt-1 ${wide ? 'mx-auto w-full max-w-[860px]' : ''}`}>
          <div className="rounded-xl border border-line bg-panel2/70 px-3 py-2">
            <button className="flex w-full items-center gap-2 text-[12px] font-semibold text-muted hover:text-fg" aria-expanded={todosOpen} onClick={() => setTodosOpen(!todosOpen)}>
              <ListChecks size={13} className="text-accent" /> Plan
              <span className="font-normal tabular-nums text-faint">
                {doneCount} of {todos.length} done
              </span>
              <span className="relative ml-1 h-1 flex-1 overflow-hidden rounded-full bg-line-strong">
                <span className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(doneCount / todos.length) * 100}%` }} />
              </span>
              {todosOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </button>
            {todosOpen && (
              <div className="anim-drop mt-1.5 max-h-40 space-y-0.5 overflow-y-auto">
                {todos.map((t, i) => (
                  <div key={i} className={`flex items-start gap-2 py-0.5 text-[12.5px] ${t.status === 'completed' ? 'text-faint line-through decoration-faint/60' : t.status === 'in_progress' ? 'text-fg' : 'text-muted'}`}>
                    {t.status === 'completed' ? (
                      <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok" />
                    ) : t.status === 'in_progress' ? (
                      <CircleDot size={13} className="mt-0.5 shrink-0 animate-pulse text-accent" />
                    ) : (
                      <Circle size={13} className="mt-0.5 shrink-0 text-faint" />
                    )}
                    {t.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className={wide ? 'mx-auto w-full max-w-[860px]' : ''}>
        <Composer />
      </div>
    </div>
  )
}
