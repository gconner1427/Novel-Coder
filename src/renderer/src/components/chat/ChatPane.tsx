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
            <div className="flex flex-col items-center px-4 pt-16 text-center">
              <Feather size={28} className="mb-3 text-accent" />
              <h2 className="mb-1 text-[16px] font-semibold">{brainstorm ? "Let's find your story" : 'What are we writing today?'}</h2>
              <p className="mb-5 max-w-[380px] text-[12.5px] text-faint">
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
              <div className="grid w-full max-w-[380px] gap-2">
                {starters.map((s) => (
                  <button key={s.label} className="rounded-lg border border-line bg-panel2 px-3 py-2 text-left text-[12.5px] hover:border-accent" onClick={() => (s.text.startsWith('/') ? set({ draft: s.text }) : void sendToEngine(s.text))}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <MessageList items={session.items} />
          )}
          {busy && (
            <div className="thinking-dots my-2 flex items-center gap-1 pl-1 text-accent">
              <span>●</span>
              <span>●</span>
              <span>●</span>
              <span className="ml-2 text-[12px] text-faint">Working… (Esc to interrupt)</span>
            </div>
          )}
        </div>
      </div>

      {todos.length > 0 && (
        <div className="shrink-0 border-t border-line px-3 py-2">
          <button className="mb-1 flex w-full items-center gap-1.5 text-[12px] font-semibold text-muted" onClick={() => setTodosOpen(!todosOpen)}>
            <ListChecks size={13} /> Plan · {todos.filter((t) => t.status === 'completed').length}/{todos.length}
            <span className="flex-1" />
            {todosOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
          {todosOpen &&
            todos.map((t, i) => (
              <div key={i} className={`flex items-start gap-1.5 py-0.5 text-[12.5px] ${t.status === 'completed' ? 'text-faint line-through' : t.status === 'in_progress' ? 'text-fg' : 'text-muted'}`}>
                {t.status === 'completed' ? <CheckCircle2 size={13} className="mt-0.5 text-ok" /> : t.status === 'in_progress' ? <CircleDot size={13} className="mt-0.5 text-accent" /> : <Circle size={13} className="mt-0.5" />}
                {t.text}
              </div>
            ))}
        </div>
      )}

      <div className={wide ? 'mx-auto w-full max-w-[860px]' : ''}>
        <Composer />
      </div>
    </div>
  )
}
