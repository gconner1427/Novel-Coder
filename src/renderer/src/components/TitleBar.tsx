import { BookOpen, PanelLeft, PanelRight, Settings, Feather, Maximize2, Lightbulb, Library, LibraryBig, ChevronRight, Orbit } from 'lucide-react'
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
  const goToLibrary = useStore((s) => s.goToLibrary)
  const inside = !!(project || brainstorm)

  return (
    <header className="drag flex h-10 shrink-0 items-center gap-2 border-b border-line bg-bg pl-3 pr-[150px]">
      <button
        className={`flex items-center gap-2 rounded-md ${inside ? 'no-drag -mx-1 px-1 py-0.5 hover:bg-panel2' : 'cursor-default'}`}
        title={inside ? 'Back to your library' : undefined}
        disabled={!inside}
        style={{ opacity: 1 }}
        onClick={() => void goToLibrary()}
      >
        <span
          className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px]"
          style={{ background: 'linear-gradient(145deg, color-mix(in srgb, var(--accent) 85%, #fff 15%), color-mix(in srgb, var(--accent) 80%, #000 20%))', boxShadow: '0 1px 0 rgba(255,255,255,.25) inset, 0 2px 8px -2px color-mix(in srgb, var(--accent) 60%, transparent)' }}
        >
          <Feather size={13} strokeWidth={2.2} className="text-accent-fg" />
        </span>
        <span className="text-[13px] font-semibold tracking-[-0.01em]">Novel Coder</span>
      </button>
      {inside && (
        <button className="btn btn-ghost no-drag ml-1 px-2 py-[3px] text-[12.5px]" title="Back to your library" onClick={() => void goToLibrary()}>
          <LibraryBig size={14} /> Library
        </button>
      )}
      {project && (
        <>
          <button className="icon-btn no-drag ml-3" title="Toggle sidebar (Ctrl+B)" onClick={onToggleSidebar}>
            <PanelLeft size={15} className={sidebarOpen ? 'text-fg' : ''} />
          </button>
          <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
            {project.universe && (
              <>
                <button
                  className="no-drag flex min-w-0 items-center gap-1.5 rounded px-1 hover:bg-panel2 hover:text-fg"
                  title="Show the universe"
                  onClick={() => set({ sidebar: 'series' })}
                >
                  <Orbit size={13} className="shrink-0 text-faint" />
                  <span className="truncate">{project.universe.config.title}</span>
                </button>
                <ChevronRight size={12} className="shrink-0 text-faint" />
              </>
            )}
            {project.series && (
              <>
                <Library size={13} className="text-faint" />
                <span className="truncate">{project.series.config.title}</span>
                <ChevronRight size={12} className="text-faint" />
                <span className="text-faint">Book {project.config.seriesNumber ?? '?'}</span>
                <ChevronRight size={12} className="text-faint" />
              </>
            )}
            {!project.series && <BookOpen size={13} className="text-faint" />}
            <span className="truncate font-medium text-fg">{project.config.title}</span>
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
          <div className="no-drag flex items-center rounded-[9px] border border-line bg-panel p-[3px]" style={{ boxShadow: '0 1px 2px rgba(0,0,0,.25) inset' }} role="radiogroup" aria-label="AI engine">
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
                  className={`flex items-center gap-1.5 rounded-md px-3 py-[3px] text-[12.5px] font-medium ${on ? 'bg-raised text-fg' : 'text-faint hover:text-muted'}`}
                  style={on ? { boxShadow: 'var(--shadow-sm), 0 1px 0 rgba(255,255,255,.05) inset' } : undefined}
                >
                  <span
                    className="h-[7px] w-[7px] rounded-full transition"
                    style={{ background: `var(--${e})`, opacity: on ? 1 : 0.4, boxShadow: on ? `0 0 8px var(--${e})` : 'none' }}
                  />
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
