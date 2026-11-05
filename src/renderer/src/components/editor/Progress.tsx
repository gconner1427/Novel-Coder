import { useEffect, useState } from 'react'
import { Flame, Target, BookOpen, CalendarDays } from 'lucide-react'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { StatsFile } from '@shared/types'

export function Progress() {
  const project = useStore((s) => s.project)!
  const notify = useStore((s) => s.notify)
  const [stats, setStats] = useState<StatsFile>({ days: [] })
  const [streak, setStreak] = useState(0)
  const [goal, setGoal] = useState(project.config.dailyGoal)
  const [target, setTarget] = useState(project.config.targetWords)

  useEffect(() => {
    void api.stats.get().then((r) => {
      setStats(r.stats)
      setStreak(r.streak)
    })
  }, [project.totalWords])

  // last 30 days, filling gaps
  const days: { date: string; words: number }[] = []
  const byDate = new Map(stats.days.map((d) => [d.date, Math.max(0, d.endWords - d.startWords)]))
  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.push({ date: key, words: byDate.get(key) ?? 0 })
  }
  const max = Math.max(goal, ...days.map((d) => d.words), 1)
  const today = days[days.length - 1].words
  const written30 = days.reduce((a, d) => a + d.words, 0)
  const activeDays = days.filter((d) => d.words > 0).length
  const avg = activeDays ? Math.round(written30 / activeDays) : 0
  const remaining = Math.max(0, project.config.targetWords - project.totalWords)
  const eta = avg ? Math.ceil(remaining / avg) : null

  const statuses = project.chapters.flatMap((c) => c.scenes).reduce<Record<string, number>>((a, s) => ((a[s.status] = (a[s.status] ?? 0) + 1), a), {})

  const saveGoals = async () => {
    await api.project.saveConfig({ ...project.config, dailyGoal: goal, targetWords: target })
    notify('Goals updated.')
  }

  const Card = ({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) => (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] text-faint">
        {icon}
        {label}
      </div>
      <div className="text-[22px] font-semibold">{value}</div>
      {sub && <div className="text-[12px] text-muted">{sub}</div>}
    </div>
  )

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-[900px]">
        <h1 className="mb-6 text-[22px] font-semibold">Progress</h1>
        <div className="mb-6 grid grid-cols-4 gap-3">
          <Card icon={<BookOpen size={13} />} label="Manuscript" value={project.totalWords.toLocaleString()} sub={`${Math.round((project.totalWords / (project.config.targetWords || 1)) * 100)}% of ${project.config.targetWords.toLocaleString()}`} />
          <Card icon={<Target size={13} />} label="Today" value={today.toLocaleString()} sub={`goal ${goal.toLocaleString()}`} />
          <Card icon={<Flame size={13} />} label="Streak" value={`${streak} day${streak === 1 ? '' : 's'}`} sub="days hitting your goal" />
          <Card icon={<CalendarDays size={13} />} label="Finish estimate" value={eta ? `${eta} writing days` : '–'} sub={avg ? `at ${avg.toLocaleString()} words/day` : 'write to get an estimate'} />
        </div>

        <div className="mb-6 rounded-xl border border-line bg-panel p-4">
          <div className="mb-3 text-[13px] font-semibold">Words per day (last 30 days)</div>
          <svg viewBox="0 0 600 160" className="w-full" role="img" aria-label="Daily word counts">
            <line x1="0" x2="600" y1={150 - (goal / max) * 140} y2={150 - (goal / max) * 140} stroke="var(--faint)" strokeDasharray="4 4" />
            {days.map((d, i) => {
              const h = (d.words / max) * 140
              return (
                <g key={d.date}>
                  <title>{`${d.date}: ${d.words.toLocaleString()} words`}</title>
                  <rect x={i * 20 + 3} y={150 - h} width={14} height={Math.max(h, d.words ? 2 : 0)} rx={3} fill={d.words >= goal ? 'var(--ok)' : 'var(--accent)'} opacity={i === days.length - 1 ? 1 : 0.8} />
                </g>
              )
            })}
            <line x1="0" x2="600" y1="150" y2="150" stroke="var(--line)" />
          </svg>
          <div className="mt-1 flex justify-between text-[11px] text-faint">
            <span>{days[0].date}</span>
            <span>dashed line = daily goal</span>
            <span>today</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-line bg-panel p-4">
            <div className="mb-3 text-[13px] font-semibold">Chapters</div>
            {project.chapters.map((c) => (
              <div key={c.folder} className="mb-1.5 flex items-center gap-2 text-[12.5px]">
                <span className="w-40 truncate">{c.title}</span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-line">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.min(100, (c.words / Math.max(...project.chapters.map((x) => x.words), 1)) * 100)}%` }} />
                </span>
                <span className="w-14 text-right text-faint">{c.words.toLocaleString()}</span>
              </div>
            ))}
            <div className="mt-3 flex flex-wrap gap-2 text-[11.5px] text-muted">
              {Object.entries(statuses).map(([k, v]) => (
                <span key={k} className="rounded-full border border-line px-2 py-0.5 capitalize">
                  {k}: {v}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-line bg-panel p-4">
            <div className="mb-3 text-[13px] font-semibold">Goals</div>
            <label className="mb-2 block text-[12.5px] text-muted">
              Daily word goal
              <input type="number" min={0} step={50} className="field mt-1 block w-full" value={goal} onChange={(e) => setGoal(Number(e.target.value))} />
            </label>
            <label className="mb-3 block text-[12.5px] text-muted">
              Target length (words)
              <input type="number" min={0} step={1000} className="field mt-1 block w-full" value={target} onChange={(e) => setTarget(Number(e.target.value))} />
            </label>
            <button className="btn btn-primary" onClick={() => void saveGoals()}>
              Save goals
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
