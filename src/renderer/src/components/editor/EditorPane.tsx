import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { X, FileText, BarChart3, LayoutGrid, Sparkles, Eye, AlignLeft, MessageSquareQuote, ShieldCheck, Wand2, FolderOpen } from 'lucide-react'
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
      <div className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-line bg-panel px-1">
        {tabs.map((t) => {
          const k = tabKey(t)
          const on = k === active
          return (
            <div
              key={k}
              onMouseDown={(e) => e.button === 1 && closeTab(k)}
              onClick={() => set({ active: k })}
              className={`group flex h-8 max-w-[200px] cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-3 text-[12.5px] ${
                on ? 'border-line bg-bg text-fg' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              {t.kind === 'progress' ? <BarChart3 size={13} /> : t.kind === 'corkboard' ? <LayoutGrid size={13} /> : <FileText size={13} />}
              <span className="truncate">{tabLabel(t, titleFor)}</span>
              <button
                className="ml-1 rounded p-0.5 opacity-0 hover:bg-raised group-hover:opacity-100"
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
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        {isMd && <FormatBar editor={editorInst} />}
        <div className="flex-1" />
        {isScene && (
          <>
            <button className="btn btn-ghost py-1 text-[12px]" title="Continue writing from the end of this scene" onClick={() => void ask('continue', path)}>
              <Sparkles size={13} /> Continue
            </button>
            <button className="btn btn-ghost py-1 text-[12px]" title="Line-edit this scene" onClick={() => void ask('line-edit', path)}>
              <Wand2 size={13} /> Line edit
            </button>
            <button className="btn btn-ghost py-1 text-[12px]" title="Check this scene against the story bible" onClick={() => void ask('continuity', path)}>
              <ShieldCheck size={13} /> Continuity
            </button>
          </>
        )}
        {selection && (
          <button className="btn py-1 text-[12px]" title="Quote the selection into the chat" onClick={quoteSelection}>
            <MessageSquareQuote size={13} /> Ask about selection
          </button>
        )}
        {isMd && (
          <>
            <button className={`icon-btn ${indent ? 'text-accent' : ''}`} title="Book-style paragraph indents" onClick={() => {
              localStorage.setItem('novelcoder.indent', indent ? '0' : '1')
              setIndent(!indent)
            }}>
              <AlignLeft size={14} />
            </button>
            <button className={`icon-btn ${focusMode ? 'text-accent' : ''}`} title="Focus mode (dims all but the current paragraph)" onClick={() => setFocusMode(!focusMode)}>
              <Eye size={14} />
            </button>
          </>
        )}
        <button className="icon-btn" title="Show in Explorer" onClick={() => void api.app.showInFolder(path)}>
          <FolderOpen size={14} />
        </button>
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto px-8 pt-8" style={{ maxWidth: (settings?.editorWidth ?? 720) + 64, ['--prose-font' as string]: fontVar }}>
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
      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-line px-4 text-[11.5px] text-faint">
        <span>{path}</span>
        <div className="flex-1" />
        {selection && <span>{countWordsClient(selection)} selected</span>}
        <span>{words.toLocaleString()} words</span>
        <span>{dirty ? 'Saving…' : 'Saved'}</span>
      </div>
    </div>
  )
}

function SceneHeader({ data, setField, pov, characters }: { data: Record<string, unknown>; setField: (k: string, v: unknown) => void; pov: string; characters: string[] }) {
  const chars = Array.isArray(data.characters) ? (data.characters as string[]) : []
  return (
    <div className="mb-6 border-b border-line pb-4">
      <input
        className="mb-3 w-full bg-transparent text-[26px] font-semibold tracking-tight outline-none placeholder:text-faint"
        style={{ fontFamily: 'var(--font-prose)' }}
        placeholder="Scene title"
        value={String(data.title ?? '')}
        onChange={(e) => setField('title', e.target.value)}
      />
      <div className="grid grid-cols-[90px_1fr] items-center gap-x-3 gap-y-1.5 text-[12.5px]">
        <label className="text-faint">Status</label>
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setField('status', s)} className={`rounded-full border px-2.5 py-0.5 text-[11.5px] capitalize ${data.status === s ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted hover:text-fg'}`}>
              {s}
            </button>
          ))}
        </div>
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
    <div className="mb-6 border-b border-line pb-4">
      <input
        className="mb-3 w-full bg-transparent text-[26px] font-semibold tracking-tight outline-none"
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
