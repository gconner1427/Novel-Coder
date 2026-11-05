import { memo, useState } from 'react'
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
  Check,
  AlertTriangle,
  Loader2,
  Brain,
  Info,
  CircleAlert
} from 'lucide-react'
import type { ChatItem } from '@shared/types'
import { DiffView } from './DiffView'
import { PermissionCard } from './PermissionCard'
import { EngineDot } from '../ui'
import { useStore } from '../../store'

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

function toolMeta(name: string, input: Record<string, unknown>): { icon: React.ReactNode; label: string; detail: string } {
  const short = (p: unknown) => String(p ?? '').replace(/\\/g, '/').replace(/^.*?(manuscript|bible|outline|notes|\.novel)\//, '$1/')
  if (name.startsWith('mcp__novel__')) {
    const t = name.slice(12)
    const detail = String(input.path ?? input.name ?? input.query ?? input.which ?? input.message ?? '')
    const write = /write|upsert|update|add|create/.test(t)
    return { icon: write ? <FilePen size={13} /> : <BookOpen size={13} />, label: t.replace(/_/g, ' '), detail }
  }
  if (name.startsWith('mcp__')) return { icon: <Wrench size={13} />, label: name.split('__').slice(1).join(' · '), detail: '' }
  switch (name) {
    case 'Read':
      return { icon: <FileText size={13} />, label: 'Read', detail: short(input.file_path) }
    case 'Write':
      return { icon: <FilePen size={13} />, label: 'Write', detail: short(input.file_path) }
    case 'Edit':
    case 'MultiEdit':
      return { icon: <FilePen size={13} />, label: 'Edit', detail: short(input.file_path ?? (input.files as string[] | undefined)?.join(', ')) }
    case 'Bash':
    case 'PowerShell':
      return { icon: <Terminal size={13} />, label: 'Run', detail: String(input.command ?? '') }
    case 'Grep':
      return { icon: <Search size={13} />, label: 'Search', detail: String(input.pattern ?? '') }
    case 'Glob':
      return { icon: <Search size={13} />, label: 'Find files', detail: String(input.pattern ?? '') }
    case 'WebSearch':
      return { icon: <Globe size={13} />, label: 'Web search', detail: String(input.query ?? '') }
    case 'WebFetch':
      return { icon: <Globe size={13} />, label: 'Fetch', detail: String(input.url ?? '') }
    case 'Task':
    case 'Agent':
      return { icon: <Bot size={13} />, label: `Agent: ${input.subagent_type ?? 'general'}`, detail: String(input.description ?? '') }
    case 'TodoWrite':
      return { icon: <ListChecks size={13} />, label: 'Update plan', detail: '' }
    default:
      return { icon: <Wrench size={13} />, label: name, detail: '' }
  }
}

function ToolCard({ item, children }: { item: Extract<ChatItem, { kind: 'tool' }>; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const input = (item.input ?? {}) as Record<string, unknown>
  const m = toolMeta(item.name, input)
  const isAgent = item.name === 'Task' || item.name === 'Agent'
  return (
    <div className="my-1">
      <button className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] text-muted hover:bg-panel2" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className={item.isError ? 'text-err' : 'text-faint'}>{m.icon}</span>
        <span className="font-medium text-fg">{m.label}</span>
        <span className="min-w-0 flex-1 truncate font-[var(--font-code)] text-[11.5px] text-faint">{m.detail}</span>
        {!item.done ? <Loader2 size={12} className="animate-spin text-accent" /> : item.isError ? <AlertTriangle size={12} className="text-err" /> : <Check size={12} className="text-ok" />}
      </button>
      {item.changes?.map((c, i) => <DiffView key={i} path={c.path} kind={c.kind} before={c.before} after={c.after} />)}
      {isAgent && children && <div className="ml-3 border-l border-line pl-2">{children}</div>}
      {open && (
        <div className="ml-5 mt-1 space-y-1">
          <pre className="max-h-48 overflow-auto rounded-md border border-line bg-panel2 p-2 font-[var(--font-code)] text-[11.5px] text-muted">{JSON.stringify(item.input, null, 2)}</pre>
          {item.output !== undefined && (
            <pre className={`max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-panel2 p-2 font-[var(--font-code)] text-[11.5px] ${item.isError ? 'text-err' : 'text-muted'}`}>
              {item.output.length > 8000 ? item.output.slice(0, 8000) + '\n…' : item.output || '(no output)'}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1">
      <button className="flex items-center gap-1.5 px-1.5 text-[12px] italic text-faint hover:text-muted" onClick={() => setOpen(!open)}>
        <Brain size={12} /> Thinking {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      {open && <div className="ml-5 mt-1 whitespace-pre-wrap border-l border-line pl-3 text-[12.5px] text-faint">{text}</div>}
    </div>
  )
}

export function MessageList({ items }: { items: ChatItem[] }) {
  const children = new Map<string, ChatItem[]>()
  const top: ChatItem[] = []
  for (const it of items) {
    if (it.kind === 'tool' && it.parentToolId) {
      const arr = children.get(it.parentToolId) ?? []
      arr.push(it)
      children.set(it.parentToolId, arr)
    } else top.push(it)
  }
  const render = (it: ChatItem): React.ReactNode => {
    switch (it.kind) {
      case 'user':
        return (
          <div key={it.id} className="my-3 flex justify-end">
            <div className="max-w-[88%] rounded-2xl rounded-br-md bg-raised px-3.5 py-2 text-[13.5px]">
              <div className="whitespace-pre-wrap">{it.text}</div>
              {!!it.images?.length && <div className="mt-1 text-[11px] text-faint">📎 {it.images.length} image{it.images.length > 1 ? 's' : ''}</div>}
            </div>
          </div>
        )
      case 'assistant':
        return (
          <div key={it.id} className="my-2 flex gap-2.5">
            <span className="mt-1.5">
              <EngineDot engine={it.engine} />
            </span>
            <div className="min-w-0 flex-1 text-[13.5px]">
              <Markdown text={it.text} />
            </div>
          </div>
        )
      case 'thinking':
        return <Thinking key={it.id} text={it.text} />
      case 'tool':
        return (
          <ToolCard key={it.id} item={it}>
            {children.get(it.id)?.map(render)}
          </ToolCard>
        )
      case 'permission':
        return <PermissionCard key={it.id} item={it} />
      case 'notice':
        return (
          <div key={it.id} className={`my-2 flex items-start gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] ${it.level === 'error' ? 'bg-err/10 text-err' : 'text-faint'}`}>
            {it.level === 'error' ? <CircleAlert size={13} className="mt-0.5 shrink-0" /> : <Info size={13} className="mt-0.5 shrink-0" />}
            <span className="whitespace-pre-wrap">{it.text}</span>
          </div>
        )
    }
  }
  return <>{top.map(render)}</>
}
