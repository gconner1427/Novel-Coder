import { useEffect, useState, type ReactNode } from 'react'
import { FileDown, FolderOpen, LogIn, CheckCircle2, AlertCircle, BookOpen, FileText, Book, FileType, Library } from 'lucide-react'
import { api, type AiSyncStatus, type ScaffoldOptions } from '../../lib/api'
import { useStore } from '../../store'
import { Modal } from '../ui'
import { useUpdateStatus } from '../UpdateBanner'
import { WhatsNewDialog, openWhatsNew } from '../WhatsNew'
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
  if (dialog === 'whats-new') return <WhatsNewDialog onClose={close} />
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

// ---------------- Settings: one scrolling page with a side menu ----------------

/** A label and hint on the left, its control on the right. */
function Row({ label, hint, children, align = 'center' }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; align?: 'center' | 'start' }) {
  return (
    <div className={`flex gap-6 border-b border-line py-3.5 last:border-0 ${align === 'center' ? 'items-center' : 'items-start'}`}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-relaxed text-faint">{hint}</div>}
      </div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`settings-${id}`} data-section={id} className="mb-9 scroll-mt-1">
      <h3 className="mb-1 text-[16px] font-semibold tracking-[-0.01em]">{title}</h3>
      {children}
    </section>
  )
}

/** Segmented control: a small group of mutually exclusive options. */
function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex rounded-[9px] border border-line bg-bg p-[3px]" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            className={`rounded-md px-3 py-1 text-[12.5px] ${on ? 'bg-raised font-medium text-fg' : 'text-faint hover:text-muted'}`}
            style={on ? { boxShadow: 'var(--shadow-sm), 0 1px 0 rgba(255,255,255,.05) inset' } : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
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
  const [active, setActive] = useState('accounts')
  useEffect(() => {
    void api.app.version().then(setVersion)
    void api.auth.status().then((a) => set({ auth: a }))
  }, [set])

  // Highlight the menu entry for the section in view.
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-section]'))
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (vis[0]) setActive((vis[0].target as HTMLElement).dataset.section!)
      },
      { rootMargin: '0px 0px -65% 0px' }
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [project])

  const upd = async (p: Partial<typeof settings>) => set({ settings: await api.app.setSettings(p) })
  const dirty = !!(project && cfg && JSON.stringify(cfg) !== JSON.stringify(project.config))
  const save = async () => {
    if (!cfg) return
    await api.project.saveConfig(cfg)
    notify('Saved the settings for this book.')
  }

  const sections = [
    ['accounts', 'Accounts'],
    ['appearance', 'Appearance'],
    ...(project ? [['book', 'This book'], ['devices', 'Devices & AI memory']] : []),
    ['updates', 'Updates'],
    ['about', 'About']
  ] as [string, string][]

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      width={820}
      footer={
        dirty ? (
          <div className="flex w-full items-center gap-3">
            <span className="flex-1 text-[12.5px] text-muted">You have unsaved changes to this book's settings.</span>
            <button className="btn btn-ghost" onClick={() => setCfg(project!.config)}>
              Discard
            </button>
            <button className="btn btn-primary" onClick={() => void save()}>
              Save changes
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="flex min-h-[520px] gap-8">
        <nav className="sticky top-0 flex w-44 shrink-0 flex-col gap-0.5 self-start" aria-label="Settings sections">
          {sections.map(([id, label]) => (
            <button
              key={id}
              className={`rounded-lg px-3 py-1.5 text-left text-[13px] ${active === id ? 'bg-panel2 font-medium text-fg' : 'text-muted hover:bg-panel2/60 hover:text-fg'}`}
              onClick={() => {
                setActive(id)
                document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 pb-[30vh]">
          <Section id="accounts" title="Accounts">
            {(['claude', 'codex'] as EngineId[]).map((e) => {
              const a = auth?.[e]
              return (
                <Row
                  key={e}
                  label={
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: `var(--${e})`, boxShadow: `0 0 6px var(--${e})` }} />
                      {e === 'claude' ? 'Claude' : 'Codex'}
                      <span className="font-normal text-faint">{e === 'claude' ? 'Claude Code engine' : 'ChatGPT'}</span>
                    </span>
                  }
                  hint={
                    <span className="flex items-center gap-1">
                      {a?.loggedIn ? <CheckCircle2 size={12} className="text-ok" /> : <AlertCircle size={12} className="text-warn" />}
                      {a?.detail ?? 'Checking…'}
                    </span>
                  }
                >
                  {a && !a.installed && e === 'claude' ? (
                    <button className="btn text-[12.5px]" onClick={() => void api.app.openExternal('https://code.claude.com/docs/en/setup')}>
                      <LogIn size={13} /> Install Claude Code
                    </button>
                  ) : (
                    <button className="btn text-[12.5px]" disabled={a && !a.installed} onClick={() => void api.auth.login(e)}>
                      <LogIn size={13} /> {a?.loggedIn ? 'Re-login' : 'Log in'}
                    </button>
                  )}
                </Row>
              )
            })}
            <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
              Novel Coder runs Claude Code (installed separately from Anthropic) and Codex on your computer. You sign in to each through its own login, and usage counts against your own Claude or ChatGPT plan. Novel Coder never sees your credentials.
            </p>
          </Section>

          <Section id="appearance" title="Appearance">
            <Row label="Theme" hint="System follows your Windows setting.">
              <Segmented
                label="Theme"
                value={settings.theme}
                onChange={(v) => void upd({ theme: v })}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' }
                ]}
              />
            </Row>
            <Row label="Editor font" hint="The typeface your manuscript is written in.">
              <Segmented
                label="Editor font"
                value={settings.editorFont}
                onChange={(v) => void upd({ editorFont: v })}
                options={[
                  { value: 'serif', label: <span style={{ fontFamily: 'var(--font-prose)' }}>Book</span> },
                  { value: 'sans', label: 'Sans' },
                  { value: 'mono', label: <span style={{ fontFamily: 'var(--font-code)' }}>Typewriter</span> }
                ]}
              />
            </Row>
            <Row label="Page width" hint="How wide the writing column is.">
              <input
                type="range"
                min={520}
                max={1100}
                step={20}
                className="w-40 accent-[var(--accent)]"
                aria-label="Page width"
                value={settings.editorWidth}
                onChange={(e) => void upd({ editorWidth: Number(e.target.value) })}
              />
              <span className="w-12 text-right text-[12px] tabular-nums text-faint">{settings.editorWidth}px</span>
            </Row>
          </Section>

          {project && cfg && (
            <Section id="book" title="This book">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-2 text-[12.5px] text-muted">
                {(['title', 'author', 'genre', 'pov', 'tense'] as const).map((k) => (
                  <label key={k}>
                    {k === 'pov' ? 'Point of view' : k[0].toUpperCase() + k.slice(1)}
                    <input className="field mt-1 w-full text-fg" value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
                  </label>
                ))}
                <label>
                  Default AI
                  <select className="field mt-1 w-full text-fg" value={cfg.defaultEngine} onChange={(e) => setCfg({ ...cfg, defaultEngine: e.target.value as EngineId })}>
                    <option value="claude">Claude</option>
                    <option value="codex">Codex</option>
                  </select>
                </label>
                <label>
                  Target length (words)
                  <input type="number" min={0} step={1000} className="field mt-1 w-full text-fg" value={cfg.targetWords} onChange={(e) => setCfg({ ...cfg, targetWords: Number(e.target.value) || 0 })} />
                </label>
                <label>
                  Daily goal (words)
                  <input type="number" min={0} step={100} className="field mt-1 w-full text-fg" value={cfg.dailyGoal} onChange={(e) => setCfg({ ...cfg, dailyGoal: Number(e.target.value) || 0 })} />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn text-[12.5px]" onClick={() => void api.app.openPath(project.root)}>
                  <FolderOpen size={13} /> Open book folder
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
                  className="btn btn-ghost text-[12.5px]"
                  onClick={() => void useStore.getState().goToLibrary()}
                >
                  Close book
                </button>
              </div>
            </Section>
          )}

          <DevicesSection />
          <UpdatesSection />

          <Section id="about" title="About">
            <Row label={`Novel Coder ${version}`} hint="An AI writing studio for novelists, powered by Claude Code and Codex.">
              <button className="btn text-[12.5px]" onClick={() => openWhatsNew()}>
                What's new in this version
              </button>
            </Row>
          </Section>
        </div>
      </div>
    </Modal>
  )
}

const ago = (t?: number) => {
  if (!t) return 'never'
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`
  return new Date(t).toLocaleDateString()
}

/** AI memory and chats are kept in the book so they follow it between devices. */
function DevicesSection() {
  const project = useStore((s) => s.project)
  const notify = useStore((s) => s.notify)
  const openTab = useStore((s) => s.openTab)
  const refreshSessions = useStore((s) => s.refreshSessions)
  const set = useStore((s) => s.set)
  const [st, setSt] = useState<AiSyncStatus | null>(null)
  const [busy, setBusy] = useState<'save' | 'load' | null>(null)
  const refresh = () => void api.aisync.status().then(setSt)
  useEffect(refresh, [project?.root])
  if (!project) return null
  const others = st?.devices.filter((d) => !d.thisDevice) ?? []

  const run = async (which: 'save' | 'load') => {
    setBusy(which)
    try {
      const r = which === 'save' ? await api.aisync.save() : await api.aisync.load()
      if (which === 'save') notify(r.saved.chats + r.saved.memory ? `Saved ${r.saved.chats} chat${r.saved.chats === 1 ? '' : 's'} and ${r.saved.memory} memory note${r.saved.memory === 1 ? '' : 's'} to the book.` : 'Everything was already saved to the book.')
      else {
        const n = r.loaded.chats + r.loaded.memory + r.loaded.removed
        notify(n ? `Loaded ${r.loaded.chats} chat${r.loaded.chats === 1 ? '' : 's'} and ${r.loaded.memory + r.loaded.removed} memory change${r.loaded.memory + r.loaded.removed === 1 ? '' : 's'}${r.fromDevices.length ? ` from ${r.fromDevices.join(', ')}` : ''}.` : 'This device already has everything saved in the book.')
        void refreshSessions()
      }
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(null)
      refresh()
    }
  }

  return (
    <Section id="devices" title="Devices & AI memory">
      <div data-testid="devices">
        <p className="mb-1 text-[12.5px] leading-relaxed text-faint">
          The AI's memory and your chats for this book are kept in the book's folder, so if it's in cloud storage they follow you to your other devices. Novel Coder saves them after each reply and loads them when you open the book.
        </p>
        {st && (
          <>
            <Row label="This device" hint={`${st.thisDevice}, saved ${ago(st.lastSave)}`} />
            <Row label="Other devices" hint={others.length ? others.map((d) => `${d.name} (saved ${ago(d.lastSave)})`).join(', ') : 'None yet'} />
            <Row label="In the book" hint={`${st.chats} chat${st.chats === 1 ? '' : 's'} and ${st.memoryNotes} memory note${st.memoryNotes === 1 ? '' : 's'}`}>
              <button
                className="btn text-[12.5px]"
                disabled={st.memoryNotes === 0}
                onClick={() => {
                  set({ dialog: null })
                  openTab({ kind: 'file', path: `${st.memoryDir}/MEMORY.md` })
                }}
              >
                <FileText size={13} /> Open the AI's memory
              </button>
            </Row>
          </>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn text-[12.5px]" disabled={!!busy} onClick={() => void run('save')}>
            <FileDown size={13} /> {busy === 'save' ? 'Saving…' : 'Save now'}
          </button>
          <button className="btn text-[12.5px]" disabled={!!busy} onClick={() => void run('load')}>
            <FolderOpen size={13} /> {busy === 'load' ? 'Loading…' : 'Load now'}
          </button>
        </div>
      </div>
    </Section>
  )
}

function UpdatesSection() {
  const s = useUpdateStatus()
  const [busy, setBusy] = useState(false)
  if (!s) return null
  const line =
    s.state === 'unsupported'
      ? s.message
      : s.state === 'checking'
        ? 'Checking GitHub for a new release…'
        : s.state === 'none'
          ? `You're up to date (version ${s.current}).${s.checkedAt ? ` Checked ${new Date(s.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}`
          : s.state === 'available'
            ? `Version ${s.version} is available. You have ${s.current}.`
            : s.state === 'downloading'
              ? `Downloading version ${s.version}… ${s.percent ?? 0}%`
              : s.state === 'downloaded'
                ? `Version ${s.version} is downloaded. Restart to finish updating.`
                : s.state === 'error'
                  ? `Couldn't update: ${s.message}`
                  : `Version ${s.current}. Updates are checked each time Novel Coder opens.`
  return (
    <Section id="updates" title="Updates">
      <Row
        label={s.state === 'available' || s.state === 'downloaded' ? 'An update is ready' : 'Novel Coder updates'}
        hint={
          <span className={s.state === 'error' ? 'text-err' : ''} data-testid="update-line">
            {line}
          </span>
        }
      >
        {s.state === 'available' && (
          <button className="btn btn-primary text-[12.5px]" onClick={() => void api.updates.download()}>
            <FileDown size={13} /> Update now
          </button>
        )}
        {s.state === 'downloaded' && (
          <button className="btn btn-primary text-[12.5px]" onClick={() => void api.updates.install()}>
            Restart and update
          </button>
        )}
        {!['available', 'downloading', 'downloaded', 'unsupported'].includes(s.state) && (
          <button
            className="btn text-[12.5px]"
            disabled={busy || s.state === 'checking'}
            onClick={async () => {
              setBusy(true)
              try {
                await api.updates.check()
              } finally {
                setBusy(false)
              }
            }}
          >
            Check for updates
          </button>
        )}
      </Row>
    </Section>
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
      <h3 className="mb-2 mt-5 section-label">Shortcuts</h3>
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
