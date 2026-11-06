import { useEffect, useState } from 'react'
import { Flame, Target, BookOpen, CalendarDays } from 'lucide-react'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { StatsFile } from '@shared/types'
import { StatusPill } from '../ui'

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

  const fmtDay = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
  const goalY = 150 - (goal / max) * 140

  const Stat = ({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) => (
    <div className="min-w-0 px-5 py-4 first:pl-6">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-faint">
        {icon}
        {label}
      </div>
      <div className="truncate text-[28px] font-semibold leading-none tabular-nums tracking-[-0.01em]" style={{ fontFamily: 'var(--font-prose)' }}>
        {value}
      </div>
      {sub && <div className="mt-1.5 truncate text-[12px] text-muted">{sub}</div>}
    </div>
  )

  return (
    <div className="desk h-full overflow-y-auto">
      <div className="mx-auto max-w-[960px] px-10 pb-16 pt-10">
        <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.015em]" style={{ fontFamily: 'var(--font-prose)' }}>
          Progress
        </h1>
        <p className="mb-7 mt-1 text-[12.5px] text-faint">{project.config.title}</p>

        <div className="mb-5 grid grid-cols-4 divide-x divide-line rounded-2xl border border-line-strong bg-panel" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <Stat icon={<BookOpen size={13} />} label="Manuscript" value={project.totalWords.toLocaleString()} sub={`${Math.round((project.totalWords / (project.config.targetWords || 1)) * 100)}% of ${project.config.targetWords.toLocaleString()}`} />
          <Stat icon={<Target size={13} />} label="Today" value={today.toLocaleString()} sub={today >= goal ? 'Goal reached' : `${(goal - today).toLocaleString()} to go`} />
          <Stat icon={<Flame size={13} />} label="Streak" value={`${streak} ${streak === 1 ? 'day' : 'days'}`} sub="in a row at your goal" />
          <Stat icon={<CalendarDays size={13} />} label="Finish estimate" value={eta ? `${eta} ${eta === 1 ? 'day' : 'days'}` : '–'} sub={avg ? `at ${avg.toLocaleString()} words a day` : 'Write a little to get one'} />
        </div>

        <div className="mb-5 rounded-2xl border border-line-strong bg-panel px-6 pb-4 pt-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="mb-4 flex items-baseline gap-3">
            <div className="text-[14px] font-semibold">Words per day</div>
            <div className="text-[12px] text-faint">Last 30 days, {written30.toLocaleString()} words</div>
            <div className="ml-auto flex items-center gap-3 text-[11.5px] text-faint">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-accent" /> Goal reached
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-accent/35" /> Below goal
              </span>
            </div>
          </div>
          <svg viewBox="0 0 600 160" className="w-full overflow-visible" role="img" aria-label="Daily word counts">
            <line x1="0" x2="600" y1="150" y2="150" stroke="var(--line-strong)" />
            {days.map((d, i) => {
              const h = (d.words / max) * 140
              const met = d.words >= goal && d.words > 0
              const isToday = i === days.length - 1
              return (
                <g key={d.date}>
                  <title>{`${fmtDay(d.date)}: ${d.words.toLocaleString()} words`}</title>
                  <rect x={i * 20 + 0} y={0} width={20} height={150} fill="transparent" />
                  <rect
                    x={i * 20 + 4}
                    y={150 - Math.max(h, d.words ? 2 : 0)}
                    width={12}
                    height={Math.max(h, d.words ? 2 : 0)}
                    rx={2.5}
                    fill="var(--accent)"
                    opacity={met ? 1 : 0.35}
                    stroke={isToday ? 'var(--fg)' : 'none'}
                    strokeOpacity={0.5}
                  />
                </g>
              )
            })}
            <line x1="0" x2="600" y1={goalY} y2={goalY} stroke="var(--accent)" strokeOpacity={0.55} strokeDasharray="3 4" />
            <text x="600" y={goalY - 5} textAnchor="end" fontSize="10" fill="var(--muted)">
              Goal {goal.toLocaleString()}
            </text>
          </svg>
          <div className="mt-2 flex justify-between text-[11px] text-faint">
            <span>{fmtDay(days[0].date)}</span>
            <span>Today</span>
          </div>
        </div>

        <div className="grid grid-cols-[1.4fr_1fr] gap-5">
          <div className="rounded-2xl border border-line-strong bg-panel p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="mb-3 text-[14px] font-semibold">Chapters</div>
            {project.chapters.map((c) => (
              <div key={c.folder} className="mb-2 flex items-center gap-3 text-[12.5px]">
                <span className="w-36 truncate">{c.title}</span>
                <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line-strong">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-accent/80" style={{ width: `${Math.min(100, (c.words / Math.max(...project.chapters.map((x) => x.words), 1)) * 100)}%` }} />
                </span>
                <span className="w-14 text-right tabular-nums text-faint">{c.words.toLocaleString()}</span>
              </div>
            ))}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[12px] text-muted">
              {['idea', 'outlined', 'drafted', 'revised', 'final']
                .filter((k) => statuses[k])
                .map((k) => (
                  <span key={k} className="flex items-center gap-1.5 capitalize">
                    <StatusPill status={k} /> {k} <span className="tabular-nums text-faint">{statuses[k]}</span>
                  </span>
                ))}
            </div>
          </div>
          <div className="rounded-2xl border border-line-strong bg-panel p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="mb-3 text-[14px] font-semibold">Goals</div>
            <label className="mb-3 block text-[12.5px] text-muted">
              Daily word goal
              <input type="number" min={0} step={50} className="field mt-1 block w-full text-fg" value={goal} onChange={(e) => setGoal(Number(e.target.value))} />
            </label>
            <label className="mb-4 block text-[12.5px] text-muted">
              Target length (words)
              <input type="number" min={0} step={1000} className="field mt-1 block w-full text-fg" value={target} onChange={(e) => setTarget(Number(e.target.value))} />
            </label>
            <button className="btn btn-primary" disabled={goal === project.config.dailyGoal && target === project.config.targetWords} onClick={() => void saveGoals()}>
              Save goals
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
