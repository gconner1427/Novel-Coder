import { useState, type ReactNode } from 'react'
import { ShieldQuestion, ClipboardList, HelpCircle, Check, X } from 'lucide-react'
import type { ChatItem, ProjectSnapshot } from '@shared/types'
import { useStore } from '../../store'
import { Markdown } from './Messages'
import { ENGINE_LABEL, docTitle } from '../ui'

type PermItem = Extract<ChatItem, { kind: 'permission' }>

export function PermissionCard({ item }: { item: PermItem }) {
  if (item.permKind === 'plan') return <PlanCard item={item} />
  if (item.permKind === 'question') return <QuestionCard item={item} />
  return <ToolPermission item={item} />
}

function Resolved({ label }: { label: string }) {
  const denied = /^(deny|denied|skipped|sent back)/i.test(label)
  return (
    <div className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-[12px] text-faint">
      {denied ? <X size={12} /> : <Check size={12} className="text-ok" />}
      {label}
    </div>
  )
}

/** Shared shell for everything the AI asks the writer: a raised card with a lamplit edge while it waits. */
function Card({ icon, title, waiting, children }: { icon: ReactNode; title: ReactNode; waiting: boolean; children: ReactNode }) {
  return (
    <div
      className={`anim-rise my-3 overflow-hidden rounded-xl border bg-raised ${waiting ? 'border-accent/35' : 'border-line'}`}
      style={{ boxShadow: waiting ? 'var(--shadow-md), 0 0 0 3px var(--accent-soft)' : 'var(--shadow-sm)' }}
    >
      <div className="flex items-start gap-2.5 px-4 pb-2 pt-3">
        <span className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${waiting ? 'bg-accent/15 text-accent' : 'bg-panel2 text-faint'}`}>{icon}</span>
        <div className="min-w-0 flex-1 pt-0.5 text-[13.5px] font-semibold leading-snug">{title}</div>
      </div>
      {children}
    </div>
  )
}

/** "edit Dusk Harvest", "run a command", "update the story bible" */
function describe(tool: string, input: Record<string, unknown>, project: ProjectSnapshot | null): { action: string; target: string } {
  const rel = String(input.file_path ?? input.path ?? '')
    .replace(/\\/g, '/')
    .replace(/^.*?(manuscript|bible|outline|notes|\.novel)\//, '$1/')
  const name = rel ? docTitle(project, rel) : ''
  if (tool === 'Write') return { action: name ? 'write' : 'create a file', target: name }
  if (tool === 'Edit' || tool === 'MultiEdit') return { action: 'edit', target: name }
  if (tool === 'Bash' || tool === 'PowerShell') return { action: 'run a command', target: '' }
  if (tool === 'WebFetch') return { action: 'open', target: String(input.url ?? '') }
  if (tool === 'WebSearch') return { action: 'search the web for', target: `“${input.query ?? ''}”` }
  if (tool.startsWith('mcp__novel__')) return { action: tool.slice(12).replace(/_/g, ' '), target: name || String(input.name ?? '') }
  return { action: `use ${tool}`, target: '' }
}

function ToolPermission({ item }: { item: PermItem }) {
  const resolve = useStore((s) => s.resolvePermission)
  const [feedback, setFeedback] = useState('')
  const input = (item.input ?? {}) as Record<string, unknown>
  const target = String(input.file_path ?? input.path ?? input.command ?? input.url ?? input.query ?? '')
  const preview = typeof input.content === 'string' ? input.content : typeof input.new_string === 'string' ? input.new_string : typeof input.body === 'string' ? input.body : ''
  const engine = useStore((s) => s.engine)
  const project = useStore((s) => s.project)
  const d = describe(item.tool, input, project)
  const isCommand = item.tool === 'Bash' || item.tool === 'PowerShell'
  return (
    <Card
      icon={<ShieldQuestion size={14} />}
      waiting={!item.resolved}
      title={
        <>
          {ENGINE_LABEL[engine]} wants to {d.action}
          {d.target && <span className="text-accent"> {d.target}</span>}
        </>
      }
    >
      <div className="px-4 pb-3 pl-[50px]">
        {target && (isCommand || !d.target) && (
          <div className={`mb-2 break-all text-[12px] text-muted ${isCommand ? 'rounded-lg border border-line bg-bg px-2.5 py-1.5 font-[var(--font-code)]' : 'truncate'}`} title={target}>
            {target}
          </div>
        )}
        {preview && (
          <div className="prose-font mb-1 max-h-44 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-panel px-3 py-2 text-[13px] leading-relaxed text-muted">{preview.slice(0, 3000)}</div>
        )}
      </div>
      {item.resolved ? (
        <Resolved label={item.resolved} />
      ) : (
        <div className="border-t border-line bg-panel/50 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary py-1 text-[12.5px]" onClick={() => resolve(item.id, 'allow')}>
              Allow
            </button>
            <button className="btn py-1 text-[12.5px]" onClick={() => resolve(item.id, 'allowAlways')}>
              Always allow this session
            </button>
            <button className="btn btn-ghost py-1 text-[12.5px]" onClick={() => resolve(item.id, 'deny', { message: feedback || undefined })}>
              Deny
            </button>
          </div>
          <input className="field mt-2.5 w-full text-[12.5px]" placeholder="Optional: tell the AI what to do instead, then press Deny" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        </div>
      )}
    </Card>
  )
}

function PlanCard({ item }: { item: PermItem }) {
  const resolve = useStore((s) => s.resolvePermission)
  const setMode = useStore((s) => s.setMode)
  const [feedback, setFeedback] = useState('')
  const plan = String((item.input as { plan?: string })?.plan ?? '')
  return (
    <Card icon={<ClipboardList size={14} />} waiting={!item.resolved} title="Here's the plan">
      {plan && (
        <div className="mx-4 mb-3 max-h-[420px] overflow-y-auto rounded-lg border border-line bg-panel px-4 py-3 text-[13px]">
          <Markdown text={plan} />
        </div>
      )}
      {item.resolved ? (
        <Resolved label={item.resolved} />
      ) : (
        <div className="border-t border-line bg-panel/50 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-primary py-1 text-[12.5px]"
              onClick={() => {
                resolve(item.id, 'allow', { label: 'Approved; auto-accepting edits' })
                void setMode('acceptEdits')
              }}
            >
              Approve & auto-accept edits
            </button>
            <button
              className="btn py-1 text-[12.5px]"
              onClick={() => {
                resolve(item.id, 'allow', { label: 'Approved; asking before edits' })
                void setMode('ask')
              }}
            >
              Approve & ask before edits
            </button>
            <button className="btn btn-ghost py-1 text-[12.5px]" onClick={() => resolve(item.id, 'deny', { message: feedback || 'Keep planning. The author wants changes to the plan.', label: 'Sent back for more planning' })}>
              Keep planning
            </button>
          </div>
          <input className="field mt-2.5 w-full text-[12.5px]" placeholder="What should change in the plan?" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        </div>
      )}
    </Card>
  )
}

interface Q {
  question: string
  header?: string
  multiSelect?: boolean
  options: { label: string; description?: string }[]
}

function QuestionCard({ item }: { item: PermItem }) {
  const resolve = useStore((s) => s.resolvePermission)
  const qs = ((item.input as { questions?: Q[] })?.questions ?? []) as Q[]
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const toggle = (q: Q, label: string) =>
    setAnswers((a) => {
      const cur = a[q.question] ?? []
      return { ...a, [q.question]: q.multiSelect ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]) : [label] }
    })
  const submit = () => {
    const out: Record<string, string> = {}
    for (const q of qs) {
      const vals = [...(answers[q.question] ?? [])]
      if (other[q.question]) vals.push(other[q.question])
      out[q.question] = vals.join(', ')
    }
    resolve(item.id, 'allow', { answers: out, label: Object.values(out).join(' · ') || 'Answered' })
  }
  return (
    <Card icon={<HelpCircle size={14} />} waiting={!item.resolved} title={qs.length === 1 ? qs[0].question : 'A few questions'}>
      <div className="space-y-4 px-4 pb-3">
        {qs.map((q) => (
          <div key={q.question}>
            {qs.length > 1 && <div className="mb-1.5 text-[13px] font-medium">{q.question}</div>}
            {item.resolved ? null : (
              <div className="space-y-1.5">
                {q.options.map((o) => {
                  const on = (answers[q.question] ?? []).includes(o.label)
                  return (
                    <button
                      key={o.label}
                      aria-pressed={on}
                      className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left ${on ? 'border-accent/60 bg-accent/10' : 'border-line bg-panel hover:border-line-strong hover:bg-panel2'}`}
                      onClick={() => toggle(q, o.label)}
                    >
                      <span
                        className={`mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${q.multiSelect ? 'rounded-[4px]' : 'rounded-full'} ${on ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong'}`}
                      >
                        {on && (q.multiSelect ? <Check size={10} strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-accent-fg" />)}
                      </span>
                      <span>
                        <span className="block text-[13px]">{o.label}</span>
                        {o.description && <span className="mt-0.5 block text-[11.5px] leading-snug text-faint">{o.description}</span>}
                      </span>
                    </button>
                  )
                })}
                <input className="field w-full text-[12.5px]" placeholder="Something else…" value={other[q.question] ?? ''} onChange={(e) => setOther((x) => ({ ...x, [q.question]: e.target.value }))} />
              </div>
            )}
          </div>
        ))}
      </div>
      {item.resolved ? (
        <Resolved label={item.resolved} />
      ) : (
        <div className="flex gap-2 border-t border-line bg-panel/50 px-4 py-3">
          <button className="btn btn-primary py-1 text-[12.5px]" onClick={submit}>
            Send answers
          </button>
          <button className="btn btn-ghost py-1 text-[12.5px]" onClick={() => resolve(item.id, 'deny', { message: 'The author skipped the question; use your best judgement.', label: 'Skipped' })}>
            Skip
          </button>
        </div>
      )}
    </Card>
  )
}
