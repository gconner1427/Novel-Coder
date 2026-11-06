import { useState } from 'react'
import { Sparkles, User } from 'lucide-react'
import { useStore } from '../../store'
import { api } from '../../lib/api'
import { StatusPill } from '../ui'

/** Index-card view of every scene: summary, POV, status. Drag cards to reorder within a chapter. */
export function Corkboard() {
  const project = useStore((s) => s.project)!
  const openTab = useStore((s) => s.openTab)
  const sendToEngine = useStore((s) => s.sendToEngine)
  const [over, setOver] = useState<string | null>(null)
  const missing = project.chapters.flatMap((c) => c.scenes).filter((s) => !s.summary).length
  return (
    <div className="desk h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-10 pb-16 pt-10">
        <div className="mb-8 flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.015em]" style={{ fontFamily: 'var(--font-prose)' }}>
              Corkboard
            </h1>
            <p className="mt-1 text-[12.5px] text-faint">Drag a card to move the scene. Double-click to open it.</p>
          </div>
          {missing > 0 && (
            <button
              className="btn text-[12.5px]"
              onClick={async () => {
                const t = await api.commands.expand('summarize', 'all scenes missing a summary')
                if (t) void sendToEngine(t, { display: '/summarize' })
              }}
            >
              <Sparkles size={13} className="text-accent" /> Fill {missing} missing {missing === 1 ? 'summary' : 'summaries'}
            </button>
          )}
        </div>
        {project.chapters.map((ch) => (
          <section key={ch.folder} className="mb-10">
            <h2 className="mb-4 flex items-baseline gap-3">
              <span className="text-[18px] font-semibold" style={{ fontFamily: 'var(--font-prose)' }}>
                {ch.title}
              </span>
              <span className="text-[12px] tabular-nums text-faint">
                {ch.scenes.length} {ch.scenes.length === 1 ? 'scene' : 'scenes'}, {ch.words.toLocaleString()} words
              </span>
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
              {ch.scenes.map((s, i) => (
                <div
                  key={s.path}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/scene', s.path)}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setOver(s.path)
                  }}
                  onDragLeave={() => setOver((o) => (o === s.path ? null : o))}
                  onDrop={async (e) => {
                    setOver(null)
                    const rel = e.dataTransfer.getData('text/scene')
                    if (!rel || rel === s.path) return
                    if (rel.startsWith(`manuscript/${ch.folder}/`)) {
                      const order = ch.scenes.map((x) => x.path).filter((p) => p !== rel)
                      order.splice(i, 0, rel)
                      await api.project.reorderScenes(ch.folder, order)
                    } else await api.project.moveScene(rel, ch.folder)
                  }}
                  onDoubleClick={() => openTab({ kind: 'file', path: s.path })}
                  className={`group flex min-h-[176px] cursor-grab flex-col rounded-lg border bg-raised px-4 pb-3 pt-3.5 transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 active:cursor-grabbing ${
                    over === s.path ? 'border-accent/70' : 'border-line-strong'
                  }`}
                  style={{ boxShadow: over === s.path ? 'var(--shadow-md), 0 0 0 3px var(--accent-soft)' : 'var(--shadow-sm)' }}
                  title="Double-click to open; drag to move"
                >
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug" style={{ fontFamily: 'var(--font-prose)' }}>
                      {s.title}
                    </span>
                    <span className="mt-0.5 flex shrink-0 items-center gap-1.5 text-[11px] capitalize text-faint">
                      <StatusPill status={s.status} /> {s.status}
                    </span>
                  </div>
                  {/* The rule where a real index card has its red line. */}
                  <div className="mb-1 mt-2.5 h-px" style={{ background: 'color-mix(in srgb, var(--accent) 45%, transparent)' }} />
                  <p
                    className="prose-font flex-1 text-[13.5px] text-muted"
                    style={{ lineHeight: '22px', backgroundImage: 'repeating-linear-gradient(transparent 0 21px, var(--line) 21px 22px)', backgroundAttachment: 'local' }}
                  >
                    {s.summary || <span className="italic text-faint">No summary yet</span>}
                  </p>
                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-faint">
                    <span className="flex min-w-0 items-center gap-1 truncate">
                      {s.pov && (
                        <>
                          <User size={11} /> {s.pov}
                        </>
                      )}
                    </span>
                    <span className="tabular-nums">{s.words.toLocaleString()} words</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
