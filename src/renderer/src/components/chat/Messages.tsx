import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ChevronRight,
  ChevronDown,
  Terminal,
  FileText,
  FilePen,
  Search,
  Globe,
  Bot,
  ListChecks,
  BookOpen,
  Wrench,
  AlertTriangle,
  Loader2,
  Brain,
  Info,
  CircleAlert,
  Paperclip
} from 'lucide-react'
import type { ChatItem, EngineId, ProjectSnapshot } from '@shared/types'
import { DiffView } from './DiffView'
import { PermissionCard } from './PermissionCard'
import { ENGINE_LABEL, docTitle } from '../ui'
import { useStore } from '../../store'

type ToolItem = Extract<ChatItem, { kind: 'tool' }>
type ThinkingItem = Extract<ChatItem, { kind: 'thinking' }>
type Step = ToolItem | ThinkingItem

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const openTab = useStore((s) => s.openTab)
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (!href) return
                if (/^https?:/.test(href)) window.novel.app.openExternal(href)
                else openTab({ kind: 'file', path: decodeURIComponent(href).replace(/^\.?\//, '') })
              }}
            >
              {children}
            </a>
          ),
          code: ({ children, className }) => {
            const t = String(children)
            const isPath = !className && /^(manuscript|bible|outline|notes|\.novel)\/[^\s]+\.md$/.test(t)
            return isPath ? (
              <code className="cursor-pointer hover:text-accent" onClick={() => openTab({ kind: 'file', path: t })}>
                {children}
              </code>
            ) : (
              <code className={className}>{children}</code>
            )
          }
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

// ---------------- tool steps ----------------

const shortPath = (p: unknown) =>
  String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^.*?(manuscript|bible|outline|notes|\.novel)\//, '$1/')

/** What kind of thing a step did, for the one-line summary of a finished group. */
type Verb = 'read' | 'edit' | 'search' | 'run' | 'web' | 'agent' | 'plan' | 'other'

interface StepMeta {
  icon: ReactNode
  verb: Verb
  /** Running and finished forms, e.g. "Reading" / "Read". */
  label: [string, string]
  /** The thing acted on, in words a writer recognises (scene title, search term…). */
  target: string
  /** Full technical detail for the tooltip. */
  detail: string
  mono?: boolean
}

function stepMeta(name: string, input: Record<string, unknown>, project: ProjectSnapshot | null): StepMeta {
  const file = (p: unknown) => {
    const s = shortPath(p)
    return { target: s ? docTitle(project, s) : '', detail: s }
  }
  if (name.startsWith('mcp__novel__')) {
    const t = name.slice(12)
    const raw = String(input.path ?? input.name ?? input.query ?? input.which ?? input.message ?? '')
    const write = /write|upsert|update|add|create|move|rename|delete/.test(t)
    const words = t.replace(/_/g, ' ')
    const pretty = words[0].toUpperCase() + words.slice(1)
    const target = /\.md$/.test(raw) ? docTitle(project, shortPath(raw)) : raw
    return { icon: write ? <FilePen size={12} /> : <BookOpen size={12} />, verb: write ? 'edit' : 'read', label: [pretty, pretty], target, detail: raw }
  }
  if (name.startsWith('mcp__')) {
    const n = name.split('__').slice(1).join(': ')
    return { icon: <Wrench size={12} />, verb: 'other', label: [n, n], target: '', detail: name }
  }
  switch (name) {
    case 'Read':
      return { icon: <FileText size={12} />, verb: 'read', label: ['Reading', 'Read'], ...file(input.file_path) }
    case 'Write':
      return { icon: <FilePen size={12} />, verb: 'edit', label: ['Writing', 'Wrote'], ...file(input.file_path) }
    case 'Edit':
    case 'MultiEdit':
      return { icon: <FilePen size={12} />, verb: 'edit', label: ['Editing', 'Edited'], ...file(input.file_path ?? (input.files as string[] | undefined)?.[0]) }
    case 'Bash':
    case 'PowerShell':
      return { icon: <Terminal size={12} />, verb: 'run', label: ['Running', 'Ran'], target: String(input.command ?? ''), detail: String(input.command ?? ''), mono: true }
    case 'Grep':
      return { icon: <Search size={12} />, verb: 'search', label: ['Searching for', 'Searched for'], target: `“${input.pattern ?? ''}”`, detail: String(input.pattern ?? '') }
    case 'Glob':
      return { icon: <Search size={12} />, verb: 'search', label: ['Finding files', 'Found files'], target: String(input.pattern ?? ''), detail: String(input.pattern ?? ''), mono: true }
    case 'WebSearch':
      return { icon: <Globe size={12} />, verb: 'web', label: ['Searching the web for', 'Searched the web for'], target: `“${input.query ?? ''}”`, detail: String(input.query ?? '') }
    case 'WebFetch':
      return { icon: <Globe size={12} />, verb: 'web', label: ['Opening', 'Opened'], target: String(input.url ?? ''), detail: String(input.url ?? '') }
    case 'Task':
    case 'Agent':
      return {
        icon: <Bot size={12} />,
        verb: 'agent',
        label: ['Helper working on', 'Helper worked on'],
        target: String(input.description ?? input.subagent_type ?? ''),
        detail: String(input.subagent_type ?? 'general')
      }
    case 'TodoWrite':
      return { icon: <ListChecks size={12} />, verb: 'plan', label: ['Updating the plan', 'Updated the plan'], target: '', detail: '' }
    default:
      return { icon: <Wrench size={12} />, verb: 'other', label: [name, name], target: '', detail: '' }
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "Read 3 files, searched twice and edited Dusk Harvest" */
function summarize(steps: Step[], project: ProjectSnapshot | null): string {
  const tools = steps.filter((s): s is ToolItem => s.kind === 'tool')
  if (!tools.length) return 'Thought it through'
  const by = new Map<Verb, StepMeta[]>()
  for (const t of tools) {
    const m = stepMeta(t.name, (t.input ?? {}) as Record<string, unknown>, project)
    by.set(m.verb, [...(by.get(m.verb) ?? []), m])
  }
  const names = (ms: StepMeta[]) => {
    const uniq = [...new Set(ms.map((m) => m.target).filter(Boolean))]
    return uniq.length === 1 ? uniq[0] : plural(uniq.length || ms.length, 'file')
  }
  const parts: string[] = []
  if (by.has('read')) parts.push(`read ${names(by.get('read')!)}`)
  if (by.has('search')) parts.push(`searched ${by.get('search')!.length === 1 ? 'once' : by.get('search')!.length === 2 ? 'twice' : `${by.get('search')!.length} times`}`)
  if (by.has('web')) parts.push('looked things up online')
  if (by.has('agent')) parts.push(`sent out ${plural(by.get('agent')!.length, 'helper')}`)
  if (by.has('run')) parts.push(`ran ${plural(by.get('run')!.length, 'command')}`)
  if (by.has('edit')) parts.push(`edited ${names(by.get('edit')!)}`)
  if (by.has('plan') && parts.length === 0) parts.push('updated the plan')
  if (by.has('other')) parts.push(`used ${plural(by.get('other')!.length, 'tool')}`)
  const s = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return s[0].toUpperCase() + s.slice(1)
}

function StepRow({ step, last, children }: { step: Step; last: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const project = useStore((s) => s.project)
  if (step.kind === 'thinking') {
    return (
      <div className="relative pl-7">
        {!last && <span className="absolute bottom-0 left-[9.5px] top-6 w-px bg-line-strong" />}
        <button className="flex h-7 items-center gap-2 text-[12.5px] text-faint hover:text-muted" onClick={() => setOpen(!open)}>
          <span className="absolute left-0 top-1 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-panel2">
            <Brain size={11} />
          </span>
          <span className="italic">Thinking</span>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {open && <div className="anim-drop mb-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-faint">{step.text}</div>}
      </div>
    )
  }
  const input = (step.input ?? {}) as Record<string, unknown>
  const m = stepMeta(step.name, input, project)
  const isAgent = step.name === 'Task' || step.name === 'Agent'
  return (
    <div className="relative pl-7">
      {!last && <span className="absolute bottom-0 left-[9.5px] top-6 w-px bg-line-strong" />}
      <button className="group flex min-h-7 w-full items-center gap-1.5 text-left text-[12.5px]" title={m.detail} onClick={() => setOpen(!open)}>
        <span
          className={`absolute left-0 top-1 flex h-5 w-5 items-center justify-center rounded-full border ${
            step.isError ? 'border-err/40 bg-err/10 text-err' : !step.done ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line bg-panel2 text-faint'
          }`}
        >
          {!step.done ? <Loader2 size={11} className="animate-spin" /> : step.isError ? <AlertTriangle size={11} /> : m.icon}
        </span>
        <span className={step.done ? 'text-muted' : 'text-fg'}>{m.label[step.done ? 1 : 0]}</span>
        {m.target && <span className={`min-w-0 truncate ${m.mono ? 'font-[var(--font-code)] text-[11.5px]' : ''} ${step.done ? 'text-faint' : 'text-muted'}`}>{m.target}</span>}
        <ChevronRight size={12} className={`ml-auto shrink-0 text-faint opacity-0 transition group-hover:opacity-100 ${open ? 'rotate-90 opacity-100' : ''}`} />
      </button>
      {isAgent && children && <div className="mb-1 ml-1 mt-0.5">{children}</div>}
      {open && (
        <div className="anim-drop mb-2 mt-1 space-y-1.5">
          <pre className="max-h-48 overflow-auto rounded-lg border border-line bg-bg p-2.5 font-[var(--font-code)] text-[11px] leading-relaxed text-muted">{JSON.stringify(step.input, null, 2)}</pre>
          {step.output !== undefined && (
            <pre className={`max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-2.5 font-[var(--font-code)] text-[11px] leading-relaxed ${step.isError ? 'text-err' : 'text-muted'}`}>
              {step.output.length > 8000 ? step.output.slice(0, 8000) + '\n…' : step.output || '(no output)'}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

/** A run of the AI's behind-the-scenes steps, shown as a timeline that folds into one line when done. */
function Activity({ steps, live, renderChildren }: { steps: Step[]; live: boolean; renderChildren: (id: string) => ReactNode }) {
  const project = useStore((s) => s.project)
  const running = live || steps.some((s) => s.kind === 'tool' && !s.done)
  const failed = steps.some((s) => s.kind === 'tool' && s.isError)
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? (running || steps.length <= 2)
  const changes = steps.flatMap((s) => (s.kind === 'tool' ? (s.changes ?? []) : []))
  return (
    <div className="my-2">
      {!running && steps.length > 2 && (
        <button className="mb-1 flex items-center gap-1.5 rounded-md py-0.5 pr-1.5 text-[12.5px] text-muted hover:text-fg" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>
          {expanded ? <ChevronDown size={13} className="text-faint" /> : <ChevronRight size={13} className="text-faint" />}
          {summarize(steps, project)}
          {failed && <AlertTriangle size={12} className="text-err" />}
        </button>
      )}
      {expanded && (
        <div className={!running && steps.length > 2 ? 'anim-drop' : ''}>
          {steps.map((s, i) => (
            <StepRow key={s.id} step={s} last={i === steps.length - 1}>
              {renderChildren(s.id)}
            </StepRow>
          ))}
        </div>
      )}
      {changes.map((c, i) => (
        <DiffView key={i} path={c.path} kind={c.kind} before={c.before} after={c.after} />
      ))}
    </div>
  )
}

function Speaker({ engine }: { engine: EngineId }) {
  return (
    <div className="mb-1.5 mt-4 flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-md border border-line-strong bg-raised">
        <span className="h-[7px] w-[7px] rounded-full" style={{ background: `var(--${engine})`, boxShadow: `0 0 6px var(--${engine})` }} />
      </span>
      <span className="text-[12px] font-semibold text-muted">{ENGINE_LABEL[engine]}</span>
    </div>
  )
}

export function MessageList({ items }: { items: ChatItem[] }) {
  const busy = useStore((s) => s.busy)
  const engine = useStore((s) => s.engine)
  const children = new Map<string, ChatItem[]>()
  const top: ChatItem[] = []
  for (const it of items) {
    if (it.kind === 'tool' && it.parentToolId) {
      const arr = children.get(it.parentToolId) ?? []
      arr.push(it)
      children.set(it.parentToolId, arr)
    } else top.push(it)
  }

  // Group runs of tool/thinking steps; note where each AI turn starts so its name is shown once.
  type Block = { kind: 'item'; item: ChatItem } | { kind: 'steps'; steps: Step[] }
  const blocks: Block[] = []
  for (const it of top) {
    const prev = blocks[blocks.length - 1]
    if (it.kind === 'tool' || it.kind === 'thinking') {
      if (prev?.kind === 'steps') prev.steps.push(it)
      else blocks.push({ kind: 'steps', steps: [it] })
    } else blocks.push({ kind: 'item', item: it })
  }

  const renderNested = (id: string): ReactNode => {
    const kids = children.get(id)
    if (!kids?.length) return null
    return <Activity steps={kids.filter((k): k is Step => k.kind === 'tool' || k.kind === 'thinking')} live={false} renderChildren={renderNested} />
  }

  let afterUser = true
  const out: ReactNode[] = []
  blocks.forEach((b, bi) => {
    const isLast = bi === blocks.length - 1
    if (b.kind === 'item' && b.item.kind === 'user') {
      const it = b.item
      afterUser = true
      out.push(
        <div key={it.id} className="mb-1 mt-5 flex justify-end first:mt-2">
          <div className="max-w-[86%] rounded-[16px] rounded-br-[5px] border border-line-strong bg-raised px-3.5 py-2 text-[13.5px] leading-relaxed" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="whitespace-pre-wrap">{it.text}</div>
            {!!it.images?.length && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-faint">
                <Paperclip size={11} /> {plural(it.images.length, 'image')}
              </div>
            )}
          </div>
        </div>
      )
      return
    }
    if (b.kind === 'item' && b.item.kind === 'notice') {
      const it = b.item
      out.push(
        it.level === 'error' ? (
          <div key={it.id} className="my-3 flex items-start gap-2 rounded-xl border border-err/25 bg-err/[0.07] px-3 py-2 text-[12.5px] text-fg">
            <CircleAlert size={14} className="mt-0.5 shrink-0 text-err" />
            <span className="whitespace-pre-wrap">{it.text}</span>
          </div>
        ) : (
          <div key={it.id} className="my-3 flex items-start justify-center gap-1.5 px-4 text-center text-[12px] text-faint">
            <Info size={12} className="mt-0.5 shrink-0" />
            <span className="whitespace-pre-wrap">{it.text}</span>
          </div>
        )
      )
      return
    }
    if (afterUser) {
      const eng = b.kind === 'item' && b.item.kind === 'assistant' ? b.item.engine : engine
      out.push(<Speaker key={`spk-${bi}`} engine={eng} />)
      afterUser = false
    }
    if (b.kind === 'steps') {
      out.push(<Activity key={b.steps[0].id} steps={b.steps} live={busy && isLast} renderChildren={renderNested} />)
      return
    }
    const it = b.item
    if (it.kind === 'assistant')
      out.push(
        <div key={it.id} className="my-1.5 text-[13.5px] leading-[1.65]">
          <Markdown text={it.text} />
        </div>
      )
    else if (it.kind === 'permission') out.push(<PermissionCard key={it.id} item={it} />)
  })
  return <>{out}</>
}
