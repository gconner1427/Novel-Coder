import { FolderOpen, Plus, Feather, CheckCircle2, AlertCircle, LogIn, Lightbulb, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../store'
import type { EngineId } from '@shared/types'
import { EngineDot, timeAgo } from './ui'

export function Welcome() {
  const settings = useStore((s) => s.settings)
  const auth = useStore((s) => s.auth)
  const set = useStore((s) => s.set)
  const loadProject = useStore((s) => s.loadProject)
  const notify = useStore((s) => s.notify)
  const brainstorms = useStore((s) => s.brainstorms)
  const startBrainstorm = useStore((s) => s.startBrainstorm)
  const openBrainstorm = useStore((s) => s.openBrainstorm)
  const refreshBrainstorms = useStore((s) => s.refreshBrainstorms)

  const open = async (dir?: string | null) => {
    dir = dir ?? (await api.app.pickFolder('Open a novel project folder'))
    if (!dir) return
    try {
      await loadProject(await api.project.open(dir))
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-10">
      <div className="w-full max-w-[720px]">
        <div className="mb-8 flex items-center gap-3">
          <Feather size={34} className="text-accent" />
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">Novel Coder</h1>
            <p className="text-muted">An agentic writing studio. Write your novel with Claude Code or Codex, on your own subscription.</p>
          </div>
        </div>

        <div className="mb-3 rounded-xl border border-accent/40 bg-accent/5 p-4">
          <div className="flex items-start gap-3">
            <Lightbulb className="mt-0.5 shrink-0 text-accent" />
            <div className="flex-1">
              <div className="font-semibold">Not sure what you're writing yet? Brainstorm with AI first</div>
              <div className="mb-3 text-[12.5px] text-faint">
                Talk an idea through: premise, characters, world, standalone or series. The AI keeps notes as you go, and when it clicks you turn it into a book or series with one click.
              </div>
              <div className="flex gap-2">
                {(['claude', 'codex'] as EngineId[]).map((e) => (
                  <button key={e} className="btn" onClick={() => void startBrainstorm(e).catch((err) => notify((err as Error).message, 'error'))}>
                    <EngineDot engine={e} /> Brainstorm with {e === 'claude' ? 'Claude' : 'Codex'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-3">
          <button className="flex items-center gap-3 rounded-xl border border-line bg-panel p-4 text-left hover:border-accent" onClick={() => set({ dialog: 'new' })}>
            <Plus className="text-accent" />
            <div>
              <div className="font-semibold">New novel or series</div>
              <div className="text-[12.5px] text-faint">Start a project with a story bible, an outline and a manuscript</div>
            </div>
          </button>
          <button className="flex items-center gap-3 rounded-xl border border-line bg-panel p-4 text-left hover:border-accent" onClick={() => void open()}>
            <FolderOpen className="text-accent" />
            <div>
              <div className="font-semibold">Open novel</div>
              <div className="text-[12.5px] text-faint">Open an existing Novel Coder folder</div>
            </div>
          </button>
        </div>

        {brainstorms.length > 0 && (
          <div className="mb-8">
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-faint">Brainstorms</h3>
            <div className="overflow-hidden rounded-xl border border-line">
              {brainstorms.slice(0, 8).map((b) => (
                <div key={b.id} className="group flex items-center gap-3 border-b border-line bg-panel px-4 py-2.5 last:border-0 hover:bg-panel2">
                  <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => void openBrainstorm(b.id)}>
                    <Lightbulb size={15} className="shrink-0 text-faint" />
                    <span className="truncate font-medium">{b.title}</span>
                    <EngineDot engine={b.engine} size={7} />
                    <span className="shrink-0 text-[12px] text-faint">{timeAgo(b.updated)}</span>
                  </button>
                  <button
                    className="hidden text-faint hover:text-err group-hover:block"
                    title="Delete brainstorm"
                    onClick={async () => {
                      if (!confirm(`Delete the brainstorm "${b.title}"?`)) return
                      await window.novel.brainstorm.delete(b.id)
                      void refreshBrainstorms()
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!!settings?.recent.length && (
          <div className="mb-8">
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-faint">Recent</h3>
            <div className="overflow-hidden rounded-xl border border-line">
              {settings.recent.map((r) => (
                <button key={r} className="flex w-full items-center gap-3 border-b border-line bg-panel px-4 py-2.5 text-left last:border-0 hover:bg-panel2" onClick={() => void open(r)}>
                  <FolderOpen size={15} className="text-faint" />
                  <span className="font-medium">{r.split(/[\\/]/).pop()}</span>
                  <span className="truncate text-[12px] text-faint">{r}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-faint">Engines</h3>
        <div className="grid grid-cols-2 gap-3">
          {(['claude', 'codex'] as EngineId[]).map((e) => {
            const a = auth?.[e]
            return (
              <div key={e} className="rounded-xl border border-line bg-panel p-4">
                <div className="mb-1 flex items-center gap-2 font-semibold">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: `var(--${e})` }} />
                  {e === 'claude' ? 'Claude (Claude Code)' : 'Codex (ChatGPT)'}
                </div>
                <div className="mb-3 flex items-center gap-1.5 text-[12.5px] text-muted">
                  {a?.loggedIn ? <CheckCircle2 size={14} className="text-ok" /> : <AlertCircle size={14} className="text-warn" />}
                  {a?.detail ?? 'Checking…'}
                </div>
                <button
                  className="btn text-[12.5px]"
                  onClick={async () => {
                    await api.auth.login(e)
                    notify('Finish signing in in the window that opened, then click Refresh.')
                  }}
                >
                  <LogIn size={14} /> {a?.loggedIn ? 'Switch account' : `Log in to ${e === 'claude' ? 'Claude' : 'ChatGPT'}`}
                </button>
                <button className="btn btn-ghost ml-1 text-[12.5px]" onClick={async () => set({ auth: await api.auth.status() })}>
                  Refresh
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
