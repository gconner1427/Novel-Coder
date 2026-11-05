import { useEffect, useState } from 'react'
import { Flame, Target } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../store'
import { EngineDot, ENGINE_LABEL } from './ui'

export function StatusBar() {
  const project = useStore((s) => s.project)!
  const engine = useStore((s) => s.engine)
  const busy = useStore((s) => s.busy)
  const usage = useStore((s) => s.usage)
  const mode = useStore((s) => s.mode)
  const openTab = useStore((s) => s.openTab)
  const [today, setToday] = useState(0)
  const [streak, setStreak] = useState(0)

  useEffect(() => {
    let alive = true
    api.stats.get().then(({ stats, streak }) => {
      if (!alive) return
      const d = stats.days[stats.days.length - 1]
      setToday(d ? Math.max(0, d.endWords - d.startWords) : 0)
      setStreak(streak)
    })
    return () => {
      alive = false
    }
  }, [project.totalWords])

  const goal = project.config.dailyGoal || 1
  const pct = Math.min(100, Math.round((today / goal) * 100))
  const bookPct = Math.min(100, Math.round((project.totalWords / (project.config.targetWords || 1)) * 100))

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[11.5px] text-muted">
      <button className="flex items-center gap-1.5 hover:text-fg" onClick={() => openTab({ kind: 'progress' })} title="Open progress">
        <span className="font-medium text-fg">{project.totalWords.toLocaleString()}</span> words
        <span className="text-faint">({bookPct}% of {project.config.targetWords.toLocaleString()})</span>
      </button>
      <button className="flex items-center gap-1.5 hover:text-fg" onClick={() => openTab({ kind: 'progress' })} title="Today's goal">
        <Target size={12} />
        <span>
          Today {today.toLocaleString()} / {goal.toLocaleString()}
        </span>
        <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-line">
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--ok)' : 'var(--accent)' }} />
        </span>
      </button>
      {streak > 0 && (
        <span className="flex items-center gap-1 text-warn">
          <Flame size={12} /> {streak}-day streak
        </span>
      )}
      <div className="flex-1" />
      <span>{project.chapters.length} chapters · {project.chapters.reduce((a, c) => a + c.scenes.length, 0)} scenes</span>
      {(usage.input > 0 || usage.output > 0) && (
        <span title="Context tokens in the last turn / output tokens this session">
          ctx {Math.round(usage.input / 1000)}k · out {Math.round(usage.output / 1000)}k
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <EngineDot engine={engine} />
        {ENGINE_LABEL[engine]} · {mode === 'ask' ? 'Ask before edits' : mode === 'acceptEdits' ? 'Auto-accept edits' : mode === 'plan' ? 'Plan mode' : 'Full auto'}
        {busy && <span className="text-accent">· working…</span>}
      </span>
    </footer>
  )
}
