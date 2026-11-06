import { useMemo, useState } from 'react'
import { diffLines, diffWordsWithSpace } from 'diff'
import { RotateCcw, FilePen } from 'lucide-react'
import { docTitle } from '../ui'
import { api } from '../../lib/api'
import { useStore } from '../../store'

/** Prose-friendly diff: changed paragraphs are shown with word-level highlights. */
export function DiffView({ path, kind, before, after }: { path: string; kind: string; before?: string; after?: string }) {
  const [expanded, setExpanded] = useState(false)
  const openTab = useStore((s) => s.openTab)
  const project = useStore((s) => s.project)
  const notify = useStore((s) => s.notify)
  const [reverted, setReverted] = useState(false)

  const { blocks, added, removed } = useMemo(() => {
    const parts = diffLines(before ?? '', after ?? '')
    let added = 0
    let removed = 0
    type Block = { type: 'ctx' | 'chg'; ctx?: string; words?: ReturnType<typeof diffWordsWithSpace> }
    const blocks: Block[] = []
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      if (!p.added && !p.removed) {
        blocks.push({ type: 'ctx', ctx: p.value })
        continue
      }
      const old = p.removed ? p.value : ''
      let neu = p.added ? p.value : ''
      if (p.removed && parts[i + 1]?.added) {
        neu = parts[i + 1].value
        i++
      }
      // Count the words that actually changed, not the whole paragraphs they sit in.
      const words = diffWordsWithSpace(old, neu)
      const count = (t: string) => t.split(/\s+/).filter(Boolean).length
      for (const w of words) {
        if (w.added) added += count(w.value)
        else if (w.removed) removed += count(w.value)
      }
      blocks.push({ type: 'chg', words })
    }
    return { blocks, added, removed }
  }, [before, after])

  const trimCtx = (t: string, pos: 'start' | 'end' | 'mid') => {
    const lines = t.replace(/\n$/, '').split('\n')
    if (expanded || lines.length <= 4) return t
    if (pos === 'start') return '…\n' + lines.slice(-2).join('\n') + '\n'
    if (pos === 'end') return lines.slice(0, 2).join('\n') + '\n…'
    return lines.slice(0, 2).join('\n') + '\n…\n' + lines.slice(-2).join('\n') + '\n'
  }

  const revert = async () => {
    if (before === undefined) await api.project.deleteFile(path)
    else await api.project.writeFile(path, before)
    setReverted(true)
    notify(`Reverted ${path}`)
  }

  const title = docTitle(project, path)
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-line-strong bg-panel" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px]">
        <FilePen size={13} className="shrink-0 text-accent" />
        <button className="min-w-0 truncate font-medium text-fg hover:underline" title={`Open ${path}`} onClick={() => openTab({ kind: 'file', path })}>
          {title}
        </button>
        {kind === 'add' && <span className="rounded-full bg-ok/15 px-1.5 text-[10.5px] font-medium text-ok">New</span>}
        {kind === 'delete' && <span className="rounded-full bg-err/15 px-1.5 text-[10.5px] font-medium text-err">Deleted</span>}
        <span className="shrink-0 tabular-nums text-faint">
          <span className="text-ok">+{added}</span> <span className="text-err">−{removed}</span> words
        </span>
        <div className="flex-1" />
        {!reverted ? (
          <button className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-faint hover:bg-err/10 hover:text-err" title="Undo this change" onClick={() => void revert()}>
            <RotateCcw size={12} /> Revert
          </button>
        ) : (
          <span className="shrink-0 text-faint">Reverted</span>
        )}
      </div>
      <div className="relative">
        <div className={`overflow-y-auto prose-font whitespace-pre-wrap px-3.5 py-3 text-[13.5px] leading-[1.7] ${expanded ? 'max-h-[600px]' : 'max-h-[240px] overflow-hidden'}`}>
          {blocks.map((b, i) =>
            b.type === 'ctx' ? (
              <span key={i} className="text-faint">
                {trimCtx(b.ctx!, i === 0 ? 'start' : i === blocks.length - 1 ? 'end' : 'mid')}
              </span>
            ) : (
              <span key={i}>
                {b.words!.map((w, j) =>
                  w.added ? (
                    <span key={j} className="rounded-[3px] bg-ok/[0.16] text-fg" style={{ boxShadow: '0 0 0 1px color-mix(in srgb, var(--ok) 20%, transparent)' }}>
                      {w.value}
                    </span>
                  ) : w.removed ? (
                    <span key={j} className="text-err/80 line-through decoration-err/50">
                      {w.value}
                    </span>
                  ) : (
                    <span key={j}>{w.value}</span>
                  )
                )}
              </span>
            )
          )}
        </div>
        {!expanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10" style={{ background: 'linear-gradient(transparent, var(--panel))' }} />}
      </div>
      <button className="flex w-full items-center justify-center gap-1 border-t border-line py-1 text-[11.5px] text-faint hover:bg-panel2 hover:text-fg" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Show less' : 'Show the whole change'}
      </button>
    </div>
  )
}
