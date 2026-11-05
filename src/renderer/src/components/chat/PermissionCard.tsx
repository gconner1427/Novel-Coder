import { useState } from 'react'
import { ShieldQuestion, ClipboardList, HelpCircle } from 'lucide-react'
import type { ChatItem } from '@shared/types'
import { useStore } from '../../store'
import { Markdown } from './Messages'

type PermItem = Extract<ChatItem, { kind: 'permission' }>

export function PermissionCard({ item }: { item: PermItem }) {
  if (item.permKind === 'plan') return <PlanCard item={item} />
  if (item.permKind === 'question') return <QuestionCard item={item} />
  return <ToolPermission item={item} />
}

function Resolved({ label }: { label: string }) {
  return <div className="text-[11.5px] text-faint">{label}</div>
}

function ToolPermission({ item }: { item: PermItem }) {
  const resolve = useStore((s) => s.resolvePermission)
  const [feedback, setFeedback] = useState('')
  const input = (item.input ?? {}) as Record<string, unknown>
  const target = String(input.file_path ?? input.path ?? input.command ?? input.url ?? input.query ?? '')
  const preview = typeof input.content === 'string' ? input.content : typeof input.new_string === 'string' ? input.new_string : typeof input.body === 'string' ? input.body : ''
  return (
    <div className="my-2 rounded-lg border border-accent/50 bg-accent/5 p-3">
      <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold">
        <ShieldQuestion size={15} className="text-accent" />
        Allow <span className="font-[var(--font-code)] text-[12.5px]">{item.tool.replace(/^mcp__novel__/, 'novel · ')}</span>?
      </div>
      {target && <div className="mb-1 truncate font-[var(--font-code)] text-[12px] text-muted">{target}</div>}
      {preview && (
        <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-panel2 p-2 text-[12px] text-muted" style={{ fontFamily: 'var(--font-prose)' }}>
          {preview.slice(0, 3000)}
        </pre>
      )}
      {item.resolved ? (
        <Resolved label={item.resolved} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary py-1 text-[12.5px]" onClick={() => resolve(item.id, 'allow')}>
              Allow
            </button>
            <button className="btn py-1 text-[12.5px]" onClick={() => resolve(item.id, 'allowAlways')}>
              Always allow this session
            </button>
            <button className="btn py-1 text-[12.5px]" onClick={() => resolve(item.id, 'deny', { message: feedback || undefined })}>
              Deny
            </button>
          </div>
          <input className="field mt-2 w-full text-[12.5px]" placeholder="Optional: tell the AI what to do instead, then press Deny" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        </>
      )}
    </div>
  )
}

function PlanCard({ item }: { item: PermItem }) {
  const resolve = useStore((s) => s.resolvePermission)
  const setMode = useStore((s) => s.setMode)
  const [feedback, setFeedback] = useState('')
  const plan = String((item.input as { plan?: string })?.plan ?? '')
  return (
    <div className="my-2 rounded-lg border border-codex/50 bg-codex/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
        <ClipboardList size={15} className="text-codex" /> Proposed plan
      </div>
      {plan && (
        <div className="mb-3 max-h-[420px] overflow-y-auto rounded-md border border-line bg-panel p-3 text-[13px]">
          <Markdown text={plan} />
        </div>
      )}
      {item.resolved ? (
        <Resolved label={item.resolved} />
      ) : (
        <>
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
            <button className="btn py-1 text-[12.5px]" onClick={() => resolve(item.id, 'deny', { message: feedback || 'Keep planning. The author wants changes to the plan.', label: 'Sent back for more planning' })}>
              Keep planning
            </button>
          </div>
          <input className="field mt-2 w-full text-[12.5px]" placeholder="What should change in the plan?" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        </>
      )}
    </div>
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
    <div className="my-2 rounded-lg border border-accent/50 bg-accent/5 p-3">
      {qs.map((q) => (
        <div key={q.question} className="mb-3">
          <div className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold">
            <HelpCircle size={14} className="text-accent" />
            {q.question}
          </div>
          {item.resolved ? null : (
            <div className="space-y-1">
              {q.options.map((o) => {
                const on = (answers[q.question] ?? []).includes(o.label)
                return (
                  <button key={o.label} className={`block w-full rounded-md border px-2.5 py-1.5 text-left ${on ? 'border-accent bg-accent/10' : 'border-line hover:bg-panel2'}`} onClick={() => toggle(q, o.label)}>
                    <div className="text-[13px]">{o.label}</div>
                    {o.description && <div className="text-[11.5px] text-faint">{o.description}</div>}
                  </button>
                )
              })}
              <input className="field w-full text-[12.5px]" placeholder="Other…" value={other[q.question] ?? ''} onChange={(e) => setOther((x) => ({ ...x, [q.question]: e.target.value }))} />
            </div>
          )}
        </div>
      ))}
      {item.resolved ? (
        <Resolved label={item.resolved} />
      ) : (
        <div className="flex gap-2">
          <button className="btn btn-primary py-1 text-[12.5px]" onClick={submit}>
            Submit answers
          </button>
          <button className="btn py-1 text-[12.5px]" onClick={() => resolve(item.id, 'deny', { message: 'The author skipped the question; use your best judgement.', label: 'Skipped' })}>
            Skip
          </button>
        </div>
      )}
    </div>
  )
}
