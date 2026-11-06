import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import { X, FileText, BarChart3, LayoutGrid, Sparkles, Eye, AlignLeft, MessageSquareQuote, ShieldCheck, Wand2, FolderOpen, Footprints, User, MapPin, Clock, ChevronDown } from 'lucide-react'
import { Dropdown, StatusPill } from '../ui'
import { api } from '../../lib/api'
import { useStore, tabKey, type Tab } from '../../store'
import { ProseEditor, FormatBar, countWordsClient } from './ProseEditor'
import { Progress } from './Progress'
import { Corkboard } from './Corkboard'
import type { SceneStatus } from '@shared/types'

function tabLabel(t: Tab, titleFor: (p: string) => string) {
  if (t.kind === 'file') return titleFor(t.path)
  return t.kind === 'progress' ? 'Progress' : t.kind === 'corkboard' ? 'Corkboard' : t.kind === 'settings' ? 'Settings' : 'Welcome'
}

export function EditorPane() {
  const tabs = useStore((s) => s.tabs)
  const active = useStore((s) => s.active)
  const set = useStore((s) => s.set)
  const closeTab = useStore((s) => s.closeTab)
  const project = useStore((s) => s.project)!

  const titleFor = (p: string) => {
    const sc = project.chapters.flatMap((c) => c.scenes).find((s) => s.path === p)
    if (sc) return sc.title
    const be = project.bible.find((b) => b.path === p)
    if (be) return be.name
    if (p === '../series-outline.md') return 'Series outline'
    if (p === '../SERIES.md') return 'Series instructions'
    if (p.startsWith('../bible/')) return `Series ${p.split('/').pop()!.replace(/\.md$/, '').replace('-', ' ')}`
    return p.split('/').pop()!.replace(/\.md$/, '')
  }
  const cur = tabs.find((t) => tabKey(t) === active)

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-10 shrink-0 items-stretch gap-1 overflow-x-auto overflow-y-hidden border-b border-line bg-panel px-2" role="tablist">
        {tabs.map((t) => {
          const k = tabKey(t)
          const on = k === active
          return (
            <div
              key={k}
              role="tab"
              aria-selected={on}
              onMouseDown={(e) => e.button === 1 && closeTab(k)}
              onClick={() => set({ active: k })}
              className={`group relative flex max-w-[220px] cursor-pointer items-center gap-1.5 px-2.5 text-[12.5px] transition-colors ${on ? 'text-fg' : 'text-faint hover:text-muted'}`}
            >
              {on && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent" />}
              {t.kind === 'progress' ? <BarChart3 size={13} /> : t.kind === 'corkboard' ? <LayoutGrid size={13} /> : <FileText size={13} className={on ? 'text-accent' : ''} />}
              <span className={`truncate ${on ? 'font-medium' : ''}`}>{tabLabel(t, titleFor)}</span>
              <button
                aria-label="Close tab"
                className="ml-0.5 rounded p-0.5 opacity-0 hover:bg-raised group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(k)
                }}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {!cur && <div className="flex h-full items-center justify-center text-faint">Open a scene from the sidebar.</div>}
        {cur?.kind === 'file' && <DocEditor key={cur.path} path={cur.path} />}
        {cur?.kind === 'progress' && <Progress />}
        {cur?.kind === 'corkboard' && <Corkboard />}
      </div>
    </div>
  )
}

const STATUSES: SceneStatus[] = ['idea', 'outlined', 'drafted', 'revised', 'final']

/** Editor for any project file: scene, bible entry, outline/notes or raw text. */
function DocEditor({ path }: { path: string }) {
  const project = useStore((s) => s.project)!
  const settings = useStore((s) => s.settings)
  const sendToEngine = useStore((s) => s.sendToEngine)
  const set = useStore((s) => s.set)
  const isMd = path.endsWith('.md')
  const isScene = /^manuscript\/[^/]+\/(?!_chapter)[^/]+\.md$/.test(path)
  const isBible = /^(\.\.\/)?bible\/(characters|locations|lore)\//.test(path)

  const [data, setData] = useState<Record<string, unknown>>({})
  const [body, setBody] = useState('')
  const [version, setVersion] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [selection, setSelection] = useState('')
  const [focusMode, setFocusMode] = useState(false)
  const [indent, setIndent] = useState(() => localStorage.getItem('novelcoder.indent') === '1')
  const lastSaved = useRef<string>('')
  const latest = useRef({ data, body })
  latest.current = { data, body }
  const editorRef = useRef<Editor | null>(null)
  const [editorInst, setEditorInst] = useState<Editor | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const serialize = (d: Record<string, unknown>, b: string) => JSON.stringify([d, b.trim()])

  const load = useCallback(async () => {
    if (isMd) {
      const doc = await api.project.readDoc(path)
      setData(doc.data)
      setBody(doc.body)
      lastSaved.current = serialize(doc.data, doc.body)
    } else {
      const t = await api.project.readFile(path)
      setData({})
      setBody(t)
      lastSaved.current = serialize({}, t)
    }
    setVersion((v) => v + 1)
    setDirty(false)
    setConflict(false)
    setLoaded(true)
  }, [path, isMd])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(async () => {
    const { data, body } = latest.current
    const s = serialize(data, body)
    if (s === lastSaved.current) return setDirty(false)
    if (isMd) await api.project.writeDoc(path, data, body)
    else await api.project.writeFile(path, body)
    lastSaved.current = s
    setDirty(false)
  }, [path, isMd])

  const schedule = () => {
    setDirty(true)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void save(), 700)
  }

  // flush on unmount
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        void save()
      }
    },
    [save]
  )

  // External changes (e.g. the AI edited this file): reload if we have no unsaved edits.
  useEffect(() => {
    if (!loaded) return
    let alive = true
    void (async () => {
      const doc = isMd ? await api.project.readDoc(path) : { data: {}, body: await api.project.readFile(path) }
      if (!alive) return
      const s = serialize(doc.data, doc.body)
      if (s === lastSaved.current || s === serialize(latest.current.data, latest.current.body)) return
      if (dirty) setConflict(true)
      else {
        setData(doc.data)
        setBody(doc.body)
        lastSaved.current = s
        setVersion((v) => v + 1)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  const setField = (k: string, v: unknown) => {
    setData((d) => ({ ...d, [k]: v }))
    schedule()
  }

  const ask = async (cmd: string, args: string) => {
    await save()
    const text = await api.commands.expand(cmd, args)
    if (text) void sendToEngine(text, { display: `/${cmd} ${args}` })
  }

  const quoteSelection = () => {
    const d = useStore.getState().draft
    const q = selection
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n')
    set({ draft: `${d ? d + '\n\n' : ''}In ${path}:\n${q}\n\n` })
    document.getElementById('composer-input')?.focus()
  }

  const words = countWordsClient(body)
  const fontVar = settings?.editorFont === 'sans' ? 'var(--font-ui)' : settings?.editorFont === 'mono' ? 'var(--font-code)' : 'var(--font-prose)'

  if (!loaded) return null

  return (
    <div className={`flex h-full flex-col ${focusMode ? 'focus-mode' : ''}`}>
      {/* toolbar */}
      <div className="@container flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-line bg-panel/60 px-3 py-1.5" data-testid="doc-toolbar">
        {isMd && <FormatBar editor={editorInst} />}
        <div className="flex-1" />
        {selection && (
          <button className="btn anim-fade py-1 text-[12px]" title="Quote the selection into the chat" onClick={quoteSelection}>
            <MessageSquareQuote size={13} className="text-accent" /> Ask about selection
          </button>
        )}
        {isScene && (
          <div className="flex items-center gap-0.5 rounded-[9px] border border-line bg-bg/60 p-[3px]" aria-label="AI actions">
            {(
              [
                ['continue', 'Continue writing from the end of this scene', <Sparkles size={13} />, 'Continue'],
                ['line-edit', 'Line-edit this scene', <Wand2 size={13} />, 'Line edit'],
                ['continuity', 'Check this scene against the story bible', <ShieldCheck size={13} />, 'Continuity'],
                [
                  'blocking',
                  "Check the scene's blocking line by line: positions, hands, props, entrances and exits, and whether the POV can see or hear what's narrated",
                  <Footprints size={13} />,
                  'Blocking'
                ]
              ] as const
            ).map(([cmd, title, icon, label]) => (
              <button
                key={cmd}
                className="group/ai flex items-center gap-1.5 rounded-md px-1.5 py-[3px] text-[12px] font-medium text-muted hover:bg-raised hover:text-fg"
                title={title}
                onClick={() => void ask(cmd, path)}
              >
                <span className="text-accent/80 group-hover/ai:text-accent">{icon}</span>
                <span className="hidden @[680px]:inline">{label}</span>
              </button>
            ))}
          </div>
        )}
        {isMd && (
          <div className="flex items-center gap-0.5">
            <button
              className={`icon-btn h-7 w-7 ${indent ? 'bg-panel2 text-accent' : ''}`}
              title="Book-style paragraph indents"
              aria-pressed={indent}
              onClick={() => {
                localStorage.setItem('novelcoder.indent', indent ? '0' : '1')
                setIndent(!indent)
              }}
            >
              <AlignLeft size={14} />
            </button>
            <button className={`icon-btn h-7 w-7 ${focusMode ? 'bg-panel2 text-accent' : ''}`} title="Focus mode (dims all but the current paragraph)" aria-pressed={focusMode} onClick={() => setFocusMode(!focusMode)}>
              <Eye size={14} />
            </button>
          </div>
        )}
      </div>

      {conflict && (
        <div className="flex items-center gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2 text-[12.5px]">
          This file was changed outside the editor (probably by the AI) while you had unsaved edits.
          <button className="btn py-0.5 text-[12px]" onClick={() => void load()}>
            Load their version
          </button>
          <button className="btn py-0.5 text-[12px]" onClick={() => { setConflict(false); void save() }}>
            Keep mine
          </button>
        </div>
      )}

      <div className="desk min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto px-10 pt-12" style={{ maxWidth: (settings?.editorWidth ?? 720) + 64, ['--prose-font' as string]: fontVar }}>
          {isScene && <SceneHeader data={data} setField={setField} pov={project.config.pov} characters={project.bible.filter((b) => b.kind === 'characters').map((b) => b.name)} />}
          {isBible && <BibleHeader data={data} setField={setField} />}
          {isMd && !isScene && !isBible && Object.keys(data).length > 0 && <GenericHeader data={data} setField={setField} />}
          {isMd ? (
            <ProseEditor
              value={body}
              version={version}
              editorRef={editorRef}
              onEditor={setEditorInst}
              className={indent && isScene ? 'indent' : ''}
              placeholder={isScene ? 'Start writing, or click Continue / type /draft in the chat…' : 'Write…'}
              onChange={(md) => {
                setBody(md)
                schedule()
              }}
              onSelectionChange={setSelection}
            />
          ) : (
            <textarea
              className="h-[75vh] w-full resize-none rounded-md border border-line bg-panel p-3 font-[var(--font-code)] text-[13px] outline-none"
              value={body}
              spellCheck={false}
              onChange={(e) => {
                setBody(e.target.value)
                schedule()
              }}
            />
          )}
        </div>
      </div>
      <div className="flex h-8 shrink-0 items-center gap-4 border-t border-line px-3 text-[11.5px] text-faint">
        <button className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:text-muted" title={`Show in Explorer: ${path}`} onClick={() => void api.app.showInFolder(path)}>
          <FolderOpen size={12} /> Show in folder
        </button>
        <div className="flex-1" />
        {selection && <span className="text-muted">{countWordsClient(selection).toLocaleString()} selected</span>}
        <span className="tabular-nums">{words.toLocaleString()} words</span>
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${dirty ? 'bg-warn' : 'bg-ok/70'}`} />
          {dirty ? 'Saving…' : 'Saved'}
        </span>
      </div>
    </div>
  )
}

function SceneHeader({ data, setField, pov, characters }: { data: Record<string, unknown>; setField: (k: string, v: unknown) => void; pov: string; characters: string[] }) {
  const chars = Array.isArray(data.characters) ? (data.characters as string[]) : []
  const [open, setOpen] = useState(() => localStorage.getItem('novelcoder.sceneDetails') === '1')
  const toggle = () => {
    localStorage.setItem('novelcoder.sceneDetails', open ? '0' : '1')
    setOpen(!open)
  }
  const status = String(data.status ?? 'idea')
  const facts: [ReactNode, string][] = [
    [<User size={12} />, String(data.pov ?? '')],
    [<MapPin size={12} />, String(data.location ?? '')],
    [<Clock size={12} />, String(data.time ?? '')]
  ].filter(([, v]) => v) as [ReactNode, string][]
  return (
    <div className="mb-8">
      <input
        className="mb-2 w-full bg-transparent text-[34px] font-semibold leading-tight tracking-[-0.015em] outline-none placeholder:text-faint"
        style={{ fontFamily: 'var(--font-prose)' }}
        placeholder="Scene title"
        value={String(data.title ?? '')}
        onChange={(e) => setField('title', e.target.value)}
      />
      {!open && data.summary ? <p className="mb-3 text-[15px] italic leading-relaxed text-muted" style={{ fontFamily: 'var(--font-prose)' }}>{String(data.summary)}</p> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <Dropdown<SceneStatus>
          className="-ml-2"
          value={status as SceneStatus}
          onChange={(s) => setField('status', s)}
          label={
            <span className="flex items-center gap-1.5 capitalize text-fg">
              <StatusPill status={status} /> {status}
            </span>
          }
          options={STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1), icon: <StatusPill status={s} /> }))}
        />
        {facts.map(([icon, v], i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="text-faint">{icon}</span>
            {v}
          </span>
        ))}
        <button className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-faint hover:bg-panel2 hover:text-fg" aria-expanded={open} onClick={toggle}>
          {open ? 'Hide details' : 'Scene details'} <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
      <div className="anim-drop mt-4 grid grid-cols-[90px_1fr] items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-panel/70 p-4 text-[12.5px]">
        <label className="text-faint">POV</label>
        <input className="field py-0.5" list="pov-list" placeholder={pov} value={String(data.pov ?? '')} onChange={(e) => setField('pov', e.target.value || undefined)} />
        <datalist id="pov-list">
          {characters.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <label className="text-faint">Location</label>
        <input className="field py-0.5" value={String(data.location ?? '')} onChange={(e) => setField('location', e.target.value || undefined)} />
        <label className="text-faint">Time</label>
        <input className="field py-0.5" placeholder="e.g. Day 3, evening" value={String(data.time ?? '')} onChange={(e) => setField('time', e.target.value || undefined)} />
        <label className="text-faint">Characters</label>
        <input
          className="field py-0.5"
          placeholder="Comma separated"
          value={chars.join(', ')}
          onChange={(e) => setField('characters', e.target.value ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : undefined)}
        />
        <label className="self-start pt-1 text-faint">Summary</label>
        <textarea className="field resize-none py-1" rows={2} value={String(data.summary ?? '')} onChange={(e) => setField('summary', e.target.value || undefined)} />
      </div>
      )}
      <div className="mt-6 h-px" style={{ background: 'linear-gradient(90deg, var(--line-strong), transparent)' }} />
    </div>
  )
}

const BIBLE_FIELDS = ['role', 'age', 'appearance', 'want', 'need', 'flaw']

function BibleHeader({ data, setField }: { data: Record<string, unknown>; setField: (k: string, v: unknown) => void }) {
  const aliases = Array.isArray(data.aliases) ? (data.aliases as string[]) : []
  const extra = Object.keys(data).filter((k) => !['name', 'aliases', 'summary'].includes(k))
  const keys = Array.from(new Set([...extra]))
  const [newKey, setNewKey] = useState('')
  return (
    <div className="mb-8 border-b border-line pb-5">
      <input
        className="mb-3 w-full bg-transparent text-[34px] font-semibold leading-tight tracking-[-0.015em] outline-none"
        style={{ fontFamily: 'var(--font-prose)' }}
        value={String(data.name ?? '')}
        onChange={(e) => setField('name', e.target.value)}
      />
      <div className="grid grid-cols-[100px_1fr] items-center gap-x-3 gap-y-1.5 text-[12.5px]">
        <label className="text-faint">Aliases</label>
        <input className="field py-0.5" placeholder="Nicknames, titles (comma separated)" value={aliases.join(', ')} onChange={(e) => setField('aliases', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
        <label className="self-start pt-1 text-faint">Summary</label>
        <textarea className="field resize-none py-1" rows={2} value={String(data.summary ?? '')} onChange={(e) => setField('summary', e.target.value)} />
        {keys.map((k) => (
          <FieldRow key={k} k={k} v={data[k]} setField={setField} />
        ))}
        <input className="field py-0.5 text-faint" placeholder="+ field" list="bible-fields" value={newKey} onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => {
          if (e.key === 'Enter' && newKey.trim()) {
            setField(newKey.trim().toLowerCase().replace(/\s+/g, '_'), '')
            setNewKey('')
          }
        }} />
        <datalist id="bible-fields">
          {BIBLE_FIELDS.filter((f) => !(f in data)).map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <span />
      </div>
    </div>
  )
}

function FieldRow({ k, v, setField }: { k: string; v: unknown; setField: (k: string, v: unknown) => void }) {
  const isList = Array.isArray(v)
  const str = isList ? (v as unknown[]).join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')
  return (
    <>
      <label className="truncate capitalize text-faint">{k.replace(/_/g, ' ')}</label>
      <input className="field py-0.5" value={str} onChange={(e) => setField(k, isList ? e.target.value.split(',').map((s) => s.trim()) : e.target.value)} />
    </>
  )
}

function GenericHeader({ data, setField }: { data: Record<string, unknown>; setField: (k: string, v: unknown) => void }) {
  return (
    <div className="mb-6 grid grid-cols-[100px_1fr] items-center gap-x-3 gap-y-1.5 border-b border-line pb-4 text-[12.5px]">
      {Object.keys(data).map((k) => (
        <FieldRow key={k} k={k} v={data[k]} setField={setField} />
      ))}
    </div>
  )
}
