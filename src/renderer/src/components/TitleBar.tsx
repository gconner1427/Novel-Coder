import { BookOpen, PanelLeft, PanelRight, Settings, Feather, Maximize2, Lightbulb, Library, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import type { EngineId } from '@shared/types'

export function TitleBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const project = useStore((s) => s.project)
  const brainstorm = useStore((s) => s.brainstorm)
  const engine = useStore((s) => s.engine)
  const switchEngine = useStore((s) => s.switchEngine)
  const set = useStore((s) => s.set)
  const editorHidden = useStore((s) => s.editorHidden)
  const auth = useStore((s) => s.auth)

  return (
    <header className="drag flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel pl-3 pr-[150px]">
      <div className="flex items-center gap-2">
        <Feather size={16} className="text-accent" />
        <span className="text-[13px] font-semibold tracking-tight">Novel Coder</span>
      </div>
      {project && (
        <>
          <button className="icon-btn no-drag ml-2" title="Toggle sidebar (Ctrl+B)" onClick={onToggleSidebar}>
            <PanelLeft size={15} className={sidebarOpen ? 'text-fg' : ''} />
          </button>
          <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
            {project.series && (
              <>
                <Library size={13} />
                <span className="truncate">{project.series.config.title}</span>
                <ChevronRight size={12} className="text-faint" />
                <span className="text-faint">Book {project.config.seriesNumber ?? '?'}</span>
              </>
            )}
            <BookOpen size={13} />
            <span className="truncate">{project.config.title}</span>
          </div>
        </>
      )}
      {brainstorm && (
        <div className="ml-3 flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
          <Lightbulb size={13} className="text-accent" />
          <span className="truncate">Brainstorm{brainstorm.title && brainstorm.title !== 'New brainstorm' ? `: ${brainstorm.title}` : ''}</span>
        </div>
      )}
      <div className="flex-1" />
      {(project || brainstorm) && (
        <>
          {/* Engine toggle */}
          <div className="no-drag flex items-center rounded-lg border border-line bg-panel2 p-0.5" role="radiogroup" aria-label="AI engine">
            {(['claude', 'codex'] as EngineId[]).map((e) => {
              const on = engine === e
              const a = auth?.[e]
              return (
                <button
                  key={e}
                  role="radio"
                  aria-checked={on}
                  onClick={() => void switchEngine(e)}
                  title={a ? a.detail : ''}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[12.5px] transition ${on ? 'bg-raised text-fg shadow' : 'text-muted hover:text-fg'}`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: `var(--${e})`, opacity: on ? 1 : 0.5 }} />
                  {e === 'claude' ? 'Claude' : 'Codex'}
                  {a && !a.loggedIn && <span className="text-[10px] text-warn">(sign in)</span>}
                </button>
              )
            })}
          </div>
          {project && (
            <button className="icon-btn no-drag" title="Focus chat (Ctrl+\)" onClick={() => set({ editorHidden: !editorHidden })}>
              {editorHidden ? <PanelRight size={15} /> : <Maximize2 size={14} />}
            </button>
          )}
        </>
      )}
      <button className="icon-btn no-drag" title="Settings (Ctrl+,)" onClick={() => set({ dialog: 'settings' })}>
        <Settings size={15} />
      </button>
    </header>
  )
}
