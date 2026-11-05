import { useMemo, useState } from 'react'
import { diffLines, diffWordsWithSpace } from 'diff'
import { RotateCcw, ExternalLink } from 'lucide-react'
import { api } from '../../lib/api'
import { useStore } from '../../store'

/** Prose-friendly diff: changed paragraphs are shown with word-level highlights. */
export function DiffView({ path, kind, before, after }: { path: string; kind: string; before?: string; after?: string }) {
  const [expanded, setExpanded] = useState(false)
  const openTab = useStore((s) => s.openTab)
  const notify = useStore((s) => s.notify)
  const [reverted, setReverted] = useState(false)

  const { blocks, added, removed } = useMemo(() => {
    const parts = diffLines(before ?? '', after ?? '')
    let added = 0
    let removed = 0
    type Block = { type: 'ctx' | 'chg'; ctx?: string; old?: string; neu?: string }
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
      added += neu.split(/\s+/).filter(Boolean).length
      removed += old.split(/\s+/).filter(Boolean).length
      blocks.push({ type: 'chg', old, neu })
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

  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-panel2 px-2.5 py-1 text-[11.5px]">
        <span className="truncate font-medium">{path}</span>
        <span className="text-ok">+{added}</span>
        <span className="text-err">−{removed}</span>
        <span className="text-faint">{kind === 'add' ? 'new file' : kind === 'delete' ? 'deleted' : 'words'}</span>
        <div className="flex-1" />
        <button className="text-faint hover:text-fg" title="Open file" onClick={() => openTab({ kind: 'file', path })}>
          <ExternalLink size={12} />
        </button>
        {!reverted ? (
          <button className="flex items-center gap-1 text-faint hover:text-err" title="Undo this change" onClick={() => void revert()}>
            <RotateCcw size={12} /> Revert
          </button>
        ) : (
          <span className="text-faint">reverted</span>
        )}
      </div>
      <div className={`overflow-y-auto whitespace-pre-wrap px-2.5 py-2 text-[12.5px] leading-relaxed ${expanded ? 'max-h-[600px]' : 'max-h-[260px]'}`} style={{ fontFamily: 'var(--font-prose)' }}>
        {blocks.map((b, i) =>
          b.type === 'ctx' ? (
            <span key={i} className="text-faint">
              {trimCtx(b.ctx!, i === 0 ? 'start' : i === blocks.length - 1 ? 'end' : 'mid')}
            </span>
          ) : (
            <span key={i}>
              {diffWordsWithSpace(b.old ?? '', b.neu ?? '').map((w, j) =>
                w.added ? (
                  <span key={j} className="rounded-sm bg-ok/20 text-fg">
                    {w.value}
                  </span>
                ) : w.removed ? (
                  <span key={j} className="rounded-sm bg-err/20 text-err line-through decoration-err/60">
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
      <button className="w-full border-t border-line py-0.5 text-[11px] text-faint hover:text-fg" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Collapse' : 'Expand'}
      </button>
    </div>
  )
}
