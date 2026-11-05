import { useEffect, useState } from 'react'
import { FileDown, FolderOpen, LogIn, CheckCircle2, AlertCircle, BookOpen, FileText, Book, FileType, Library } from 'lucide-react'
import { api, type ScaffoldOptions } from '../../lib/api'
import { useStore } from '../../store'
import { Modal } from '../ui'
import type { EngineId, ExportFormat, NovelConfig } from '@shared/types'

export function Dialogs() {
  const dialog = useStore((s) => s.dialog)
  const set = useStore((s) => s.set)
  const close = () => set({ dialog: null })
  if (dialog === 'new') return <NewNovelDialog onClose={close} />
  if (dialog === 'convert') return <NewNovelDialog onClose={close} convert />
  if (dialog === 'make-series') return <MakeSeriesDialog onClose={close} />
  if (dialog === 'export') return <ExportDialog onClose={close} />
  if (dialog === 'settings') return <SettingsDialog onClose={close} />
  if (dialog === 'help') return <HelpDialog onClose={close} />
  return null
}

const GENRES = ['Literary', 'Fantasy', 'Science fiction', 'Mystery', 'Thriller', 'Romance', 'Horror', 'Historical', 'Young adult', 'Middle grade', 'Other']

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[12.5px] text-muted">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  )
}

const POVS = ['First person', 'Second person', 'Third person limited', 'Third person omniscient', 'Multiple POV (third limited)', 'Multiple POV (first person)']

/** Map free-text POV from a brainstorm onto one of the dropdown options. */
function matchPov(p?: string): string | undefined {
  if (!p) return undefined
  const l = p.toLowerCase()
  if (/multi|multiple|rotating|several/.test(l)) return /first/.test(l) ? POVS[5] : POVS[4]
  if (/first/.test(l)) return POVS[0]
  if (/second/.test(l)) return POVS[1]
  if (/omni/.test(l)) return POVS[3]
  if (/third|close|limited/.test(l)) return POVS[2]
  return undefined
}

function NewNovelDialog({ onClose, convert = false }: { onClose: () => void; convert?: boolean }) {
  const loadProject = useStore((s) => s.loadProject)
  const convertBrainstorm = useStore((s) => s.convertBrainstorm)
  const notify = useStore((s) => s.notify)
  const fields = useStore((s) => s.brainstorm?.fields) ?? {}
  const [o, setO] = useState<ScaffoldOptions>(() => {
    const genre = fields.genre ? GENRES.find((g) => g.toLowerCase() === fields.genre!.toLowerCase()) ?? fields.genre : 'Literary'
    return {
      kind: fields.series ? 'series' : 'novel',
      title: fields.series ? '' : fields.title ?? '',
      seriesTitle: fields.series ? fields.title ?? '' : '',
      plannedBooks: fields.plannedBooks ?? 3,
      author: '',
      genre,
      pov: matchPov(fields.pov) ?? 'Third person limited',
      tense: fields.tense && /present/i.test(fields.tense) ? 'Present' : 'Past',
      targetWords: 80000,
      dailyGoal: 1000,
      beatSheet: 'save-the-cat',
      premise: fields.premise ?? ''
    }
  })
  const series = o.kind === 'series'
  const [dir, setDir] = useState('')
  const [busy, setBusy] = useState(false)
  const up = (p: Partial<ScaffoldOptions>) => setO((x) => ({ ...x, ...p }))

  const valid = !!o.title.trim() && !!dir && (!series || !!o.seriesTitle?.trim())
  const create = async () => {
    if (!valid) return
    setBusy(true)
    try {
      const opts = { ...o, description: series ? o.premise : undefined }
      const name = series ? o.seriesTitle : o.title
      if (convert) {
        onClose()
        await convertBrainstorm(dir, opts)
        notify(`Created "${name}". The AI is now setting it up from your brainstorm.`)
        return
      }
      const p = await api.project.create(dir, opts)
      await loadProject(p)
      onClose()
      notify(`Created "${name}". Your story bible, outline and first scene are ready.`)
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={convert ? 'Turn brainstorm into a project' : series ? 'New series' : 'New novel'}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void create()}>
            {busy ? 'Creating…' : series ? 'Create series' : 'Create novel'}
          </button>
        </>
      }
    >
      {convert && (
        <p className="mb-3 rounded-md border border-line bg-panel2 px-3 py-2 text-[12.5px] text-muted">
          Pre-filled from your brainstorm notes. After it's created, the AI reads the brainstorm and builds the outline, story bible{series ? ', series plan' : ''} and first scenes.
        </p>
      )}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <KindButton on={!series} onClick={() => up({ kind: 'novel' })} icon={<BookOpen size={16} />} label="Standalone novel" hint="One book" />
        <KindButton on={series} onClick={() => up({ kind: 'series' })} icon={<Library size={16} />} label="Series" hint="Several books sharing a story bible" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {series && (
          <>
            <L label="Series title">
              <input autoFocus className="field w-full" value={o.seriesTitle} onChange={(e) => up({ seriesTitle: e.target.value })} placeholder="The Lantern Cycle" />
            </L>
            <L label="Planned books">
              <input type="number" min={2} max={20} className="field w-full" value={o.plannedBooks} onChange={(e) => up({ plannedBooks: Number(e.target.value) })} />
            </L>
          </>
        )}
        <div className="col-span-2">
          <L label={series ? 'Title of book 1' : 'Title'}>
            <input autoFocus={!series} className="field w-full" value={o.title} onChange={(e) => up({ title: e.target.value })} placeholder={series ? 'Book one title' : 'The Untitled Novel'} />
          </L>
        </div>
        <L label="Author name">
          <input className="field w-full" value={o.author} onChange={(e) => up({ author: e.target.value })} />
        </L>
        <L label="Genre">
          <select className="field w-full" value={o.genre} onChange={(e) => up({ genre: e.target.value })}>
            {GENRES.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </L>
        <L label="Point of view">
          <select className="field w-full" value={o.pov} onChange={(e) => up({ pov: e.target.value })}>
            {POVS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </L>
        <L label="Tense">
          <select className="field w-full" value={o.tense} onChange={(e) => up({ tense: e.target.value })}>
            <option>Past</option>
            <option>Present</option>
          </select>
        </L>
        <L label="Target length (words)">
          <input type="number" className="field w-full" value={o.targetWords} onChange={(e) => up({ targetWords: Number(e.target.value) })} />
        </L>
        <L label="Daily word goal">
          <input type="number" className="field w-full" value={o.dailyGoal} onChange={(e) => up({ dailyGoal: Number(e.target.value) })} />
        </L>
        <div className="col-span-2">
          <L label="Structure template">
            <div className="flex gap-2">
              {(
                [
                  ['save-the-cat', 'Save the Cat'],
                  ['three-act', 'Three-Act'],
                  ['heros-journey', "Hero's Journey"]
                ] as const
              ).map(([v, l]) => (
                <button key={v} className={`btn flex-1 justify-center ${o.beatSheet === v ? 'border-accent bg-accent/10' : ''}`} onClick={() => up({ beatSheet: v })}>
                  {l}
                </button>
              ))}
            </div>
          </L>
        </div>
        <div className="col-span-2">
          <L label={series ? 'Series premise (optional)' : 'Premise (optional; the AI uses it as a starting point)'}>
            <textarea className="field w-full resize-none" rows={3} value={o.premise} onChange={(e) => up({ premise: e.target.value })} placeholder="A lighthouse keeper discovers the ships she's been guiding home are from forty years in the future…" />
          </L>
        </div>
        <div className="col-span-2">
          <L label="Location">
            <div className="flex gap-2">
              <input className="field min-w-0 flex-1" value={dir} readOnly placeholder="Choose a folder…" />
              <button
                className="btn"
                onClick={async () => {
                  const d = await api.app.pickFolder('Where should the novel be saved?')
                  if (d) setDir(d)
                }}
              >
                <FolderOpen size={14} /> Browse
              </button>
            </div>
            <span className="mt-1 block text-[11.5px] text-faint">
              {series
                ? 'A series folder is created here, holding the shared series bible, the series outline and one folder per book.'
                : "If the folder isn't empty, a subfolder named after the title is created."}
            </span>
          </L>
        </div>
      </div>
    </Modal>
  )
}

function KindButton({ on, onClick, icon, label, hint }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <button className={`flex items-center gap-3 rounded-lg border p-3 text-left ${on ? 'border-accent bg-accent/10' : 'border-line hover:bg-panel2'}`} onClick={onClick}>
      <span className="text-accent">{icon}</span>
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="block text-[11.5px] text-faint">{hint}</span>
      </span>
    </button>
  )
}

function MakeSeriesDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!
  const makeSeries = useStore((s) => s.makeSeries)
  const notify = useStore((s) => s.notify)
  const [title, setTitle] = useState('')
  const [n, setN] = useState(3)
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title="Turn this novel into a series"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!title.trim() || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await makeSeries(title.trim(), n)
              } catch (e) {
                notify((e as Error).message, 'error')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Converting…' : 'Create series'}
          </button>
        </>
      }
    >
      <p className="mb-3 text-[12.5px] text-muted">
        <b>{project.config.title}</b> becomes Book 1. A new series folder is created next to it and the book's folder moves inside, alongside a shared
        series bible and a series outline. Nothing else about the book changes.
      </p>
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <L label="Series title">
          <input autoFocus className="field w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
        </L>
        <L label="Planned books">
          <input type="number" min={2} max={20} className="field w-full" value={n} onChange={(e) => setN(Number(e.target.value))} />
        </L>
      </div>
    </Modal>
  )
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const notify = useStore((s) => s.notify)
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const formats: { f: ExportFormat; label: string; desc: string; icon: React.ReactNode }[] = [
    { f: 'docx', label: 'Word (.docx)', desc: 'Standard manuscript format for agents and editors: 12pt, double-spaced, headers', icon: <FileType size={18} /> },
    { f: 'epub', label: 'EPUB e-book', desc: 'For e-readers and Kindle (via Send to Kindle)', icon: <Book size={18} /> },
    { f: 'pdf', label: 'PDF', desc: 'Print-ready, book-style typesetting', icon: <FileText size={18} /> },
    { f: 'md', label: 'Markdown', desc: 'The whole manuscript in one plain-text file', icon: <BookOpen size={18} /> }
  ]
  const run = async (f: ExportFormat) => {
    setBusy(f)
    try {
      const r = await api.exporter.run(f, true)
      if (r) {
        notify(`Exported ${r.words.toLocaleString()} words.`)
        void api.app.showInFolder(r.file)
        onClose()
      }
    } catch (e) {
      notify(`Export failed: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(null)
    }
  }
  return (
    <Modal title="Export manuscript" onClose={onClose}>
      <div className="space-y-2">
        {formats.map((x) => (
          <button key={x.f} disabled={!!busy} className="flex w-full items-center gap-3 rounded-lg border border-line bg-panel2 p-3 text-left hover:border-accent" onClick={() => void run(x.f)}>
            <span className="text-accent">{x.icon}</span>
            <span className="flex-1">
              <span className="block font-semibold">{x.label}</span>
              <span className="block text-[12px] text-faint">{x.desc}</span>
            </span>
            {busy === x.f ? <span className="text-[12px] text-muted">Exporting…</span> : <FileDown size={15} className="text-faint" />}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-faint">Chapters and scenes are exported in sidebar order. Scene breaks are marked with “#”.</p>
    </Modal>
  )
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings)!
  const auth = useStore((s) => s.auth)
  const project = useStore((s) => s.project)
  const set = useStore((s) => s.set)
  const notify = useStore((s) => s.notify)
  const [cfg, setCfg] = useState<NovelConfig | null>(project?.config ?? null)
  const [version, setVersion] = useState('')
  useEffect(() => {
    void api.app.version().then(setVersion)
    void api.auth.status().then((a) => set({ auth: a }))
  }, [set])

  const upd = async (p: Partial<typeof settings>) => set({ settings: await api.app.setSettings(p) })

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      width={640}
      footer={
        <>
          {project && cfg && (
            <button
              className="btn btn-primary"
              onClick={async () => {
                await api.project.saveConfig(cfg)
                notify('Project settings saved.')
                onClose()
              }}
            >
              Save project settings
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-faint">Accounts</h3>
      <div className="mb-5 space-y-2">
        {(['claude', 'codex'] as EngineId[]).map((e) => {
          const a = auth?.[e]
          return (
            <div key={e} className="flex items-center gap-3 rounded-lg border border-line bg-panel2 p-3">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: `var(--${e})` }} />
              <div className="flex-1">
                <div className="font-semibold">{e === 'claude' ? 'Claude (Claude Code engine)' : 'Codex (ChatGPT)'}</div>
                <div className="flex items-center gap-1 text-[12px] text-muted">
                  {a?.loggedIn ? <CheckCircle2 size={12} className="text-ok" /> : <AlertCircle size={12} className="text-warn" />}
                  {a?.detail}
                </div>
              </div>
              <button className="btn text-[12.5px]" onClick={() => void api.auth.login(e)}>
                <LogIn size={13} /> {a?.loggedIn ? 'Re-login' : 'Log in'}
              </button>
            </div>
          )
        })}
        <p className="text-[11.5px] text-faint">
          Novel Coder runs the official Claude Code and Codex engines on your computer, so usage counts against your own Claude Pro/Max or ChatGPT Plus/Pro plan. No API key needed.
        </p>
      </div>

      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-faint">Appearance</h3>
      <div className="mb-5 grid grid-cols-3 gap-3 text-[12.5px] text-muted">
        <label>
          Theme
          <select className="field mt-1 w-full" value={settings.theme} onChange={(e) => void upd({ theme: e.target.value as 'dark' })}>
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <label>
          Editor font
          <select className="field mt-1 w-full" value={settings.editorFont} onChange={(e) => void upd({ editorFont: e.target.value as 'serif' })}>
            <option value="serif">Serif (book)</option>
            <option value="sans">Sans-serif</option>
            <option value="mono">Typewriter</option>
          </select>
        </label>
        <label>
          Page width
          <input type="range" min={520} max={1100} step={20} className="mt-2 w-full" value={settings.editorWidth} onChange={(e) => void upd({ editorWidth: Number(e.target.value) })} />
        </label>
      </div>

      {project && cfg && (
        <>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-faint">This novel</h3>
          <div className="grid grid-cols-2 gap-3 text-[12.5px] text-muted">
            {(['title', 'author', 'genre', 'pov', 'tense'] as const).map((k) => (
              <label key={k} className="capitalize">
                {k === 'pov' ? 'Point of view' : k}
                <input className="field mt-1 w-full" value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
              </label>
            ))}
            <label>
              Default engine
              <select className="field mt-1 w-full" value={cfg.defaultEngine} onChange={(e) => setCfg({ ...cfg, defaultEngine: e.target.value as EngineId })}>
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn text-[12.5px]" onClick={() => void api.app.openPath(project.root)}>
              <FolderOpen size={13} /> Open project folder
            </button>
            {project.series ? (
              <button className="btn text-[12.5px]" onClick={() => set({ dialog: null, sidebar: 'series' })}>
                <Library size={13} /> Series settings
              </button>
            ) : (
              <button className="btn text-[12.5px]" onClick={() => set({ dialog: 'make-series' })}>
                <Library size={13} /> Turn into a series
              </button>
            )}
            <button
              className="btn text-[12.5px]"
              onClick={async () => {
                await api.project.close()
                set({ project: null, dialog: null })
              }}
            >
              Close project
            </button>
          </div>
        </>
      )}
      <p className="mt-5 text-[11px] text-faint">Novel Coder {version}</p>
    </Modal>
  )
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  const commands = useStore((s) => s.commands)
  const keys = [
    ['Enter / Shift+Enter', 'Send / new line'],
    ['Esc', 'Interrupt the AI'],
    ['/', 'Writing & app commands'],
    ['@', 'Mention a file, scene or bible entry'],
    ['Ctrl+L', 'Focus the chat'],
    ['Ctrl+B', 'Toggle sidebar'],
    ['Ctrl+\\', 'Chat-only view'],
    ['Ctrl+Shift+N', 'New conversation'],
    ['Ctrl+Shift+E', 'Export'],
    ['Ctrl+,', 'Settings']
  ]
  return (
    <Modal title="Commands & shortcuts" onClose={onClose} width={680}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px]">
        {commands.map((c) => (
          <div key={c.name} className="flex gap-2 py-0.5">
            <code className="shrink-0 text-accent">/{c.name}</code>
            <span className="text-muted">{c.description}</span>
          </div>
        ))}
      </div>
      <h3 className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-wider text-faint">Shortcuts</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px]">
        {keys.map(([k, d]) => (
          <div key={k} className="flex gap-2">
            <kbd className="shrink-0 rounded border border-line bg-panel2 px-1.5 text-[11px]">{k}</kbd>
            <span className="text-muted">{d}</span>
          </div>
        ))}
      </div>
      <p className="mt-5 text-[12px] text-faint">Add your own commands as markdown files in <code>.novel/commands/</code> inside your novel. Use $ARGUMENTS where the command's arguments should go.</p>
    </Modal>
  )
}
