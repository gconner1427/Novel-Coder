import { useStore } from '../../store'
import { api } from '../../lib/api'
import { StatusPill } from '../ui'
import { Sparkles } from 'lucide-react'

/** Index-card view of every scene: summary, POV, status. Drag cards to reorder within a chapter. */
export function Corkboard() {
  const project = useStore((s) => s.project)!
  const openTab = useStore((s) => s.openTab)
  const sendToEngine = useStore((s) => s.sendToEngine)
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-[20px] font-semibold">Corkboard</h1>
        <button
          className="btn py-1 text-[12px]"
          onClick={async () => {
            const t = await api.commands.expand('summarize', 'all scenes missing a summary')
            if (t) void sendToEngine(t, { display: '/summarize' })
          }}
        >
          <Sparkles size={13} /> Fill missing summaries
        </button>
      </div>
      {project.chapters.map((ch) => (
        <section key={ch.folder} className="mb-6">
          <h2 className="mb-2 section-label">
            {ch.title} <span className="font-normal normal-case">· {ch.words.toLocaleString()} words</span>
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {ch.scenes.map((s, i) => (
              <div
                key={s.path}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/scene', s.path)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={async (e) => {
                  const rel = e.dataTransfer.getData('text/scene')
                  if (!rel || rel === s.path) return
                  if (rel.startsWith(`manuscript/${ch.folder}/`)) {
                    const order = ch.scenes.map((x) => x.path).filter((p) => p !== rel)
                    order.splice(i, 0, rel)
                    await api.project.reorderScenes(ch.folder, order)
                  } else await api.project.moveScene(rel, ch.folder)
                }}
                onDoubleClick={() => openTab({ kind: 'file', path: s.path })}
                className="flex min-h-[130px] cursor-grab flex-col rounded-lg border border-line bg-[color-mix(in_srgb,var(--raised)_85%,#e8d9a8_15%)] p-3 shadow-sm hover:border-accent"
                title="Double-click to open; drag to reorder"
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <StatusPill status={s.status} />
                  <span className="truncate font-semibold">{s.title}</span>
                </div>
                <p className="flex-1 text-[12.5px] leading-snug text-muted" style={{ fontFamily: 'var(--font-prose)' }}>
                  {s.summary || <span className="italic text-faint">No summary yet</span>}
                </p>
                <div className="mt-2 flex justify-between text-[11px] text-faint">
                  <span>{s.pov ? `POV: ${s.pov}` : ''}</span>
                  <span>{s.words.toLocaleString()} w</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
