import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Square, Paperclip, X, ShieldCheck, Zap, ClipboardList, ShieldOff, Cpu } from 'lucide-react'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import { Dropdown } from '../ui'
import type { ExportFormat, PermissionMode } from '@shared/types'

const MODES: { value: PermissionMode; label: string; hint: string; icon: React.ReactNode }[] = [
  { value: 'ask', label: 'Ask before edits', hint: 'Approve each change to your files', icon: <ShieldCheck size={13} /> },
  { value: 'acceptEdits', label: 'Auto-accept edits', hint: 'AI edits files freely; you can revert or rewind', icon: <Zap size={13} /> },
  { value: 'plan', label: 'Plan mode', hint: 'Read-only: research and propose a plan first', icon: <ClipboardList size={13} /> },
  { value: 'auto', label: 'Full auto', hint: 'No prompts at all (commands, web, edits)', icon: <ShieldOff size={13} /> }
]

const EFFORTS: Record<string, string[]> = { claude: ['', 'low', 'medium', 'high', 'xhigh', 'max'], codex: ['', 'minimal', 'low', 'medium', 'high', 'xhigh'] }

export function Composer() {
  const draft = useStore((s) => s.draft)
  const set = useStore((s) => s.set)
  const busy = useStore((s) => s.busy)
  const engine = useStore((s) => s.engine)
  const mode = useStore((s) => s.mode)
  const prefs = useStore((s) => s.prefs)
  const models = useStore((s) => s.models)
  const commands = useStore((s) => s.commands)
  const project = useStore((s) => s.project)
  const brainstorm = useStore((s) => s.brainstorm)
  const st = useStore.getState
  const [images, setImages] = useState<string[]>([])
  const [menuIdx, setMenuIdx] = useState(0)
  const [caret, setCaret] = useState(0)
  const ta = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 260) + 'px'
  }, [draft])

  // ---- autocomplete (slash commands + @files) ----
  const slashQuery = /^\/([\w-]*)$/.exec(draft.slice(0, caret))?.[1]
  const atMatch = /(^|\s)@([^\s@]*)$/.exec(draft.slice(0, caret))
  const atQuery = atMatch?.[2]
  const menu = useMemo(() => {
    // Commands that make sense without a project while brainstorming
    const BRAINSTORM_OK = new Set(['help', 'clear', 'compact', 'engine', 'model', 'plan', 'brainstorm', 'new-brainstorm'])
    if (slashQuery !== undefined)
      return commands
        .filter((c) => c.name.startsWith(slashQuery))
        .filter((c) => !brainstorm || BRAINSTORM_OK.has(c.name))
        .filter((c) => (c.name === 'add-book' ? !!project?.series : c.name === 'make-series' ? !!project && !project.series : true))
        .slice(0, 12)
        .map((c) => ({ key: c.name, label: `/${c.name}`, hint: `${c.args ? c.args + ' · ' : ''}${c.description}`, tag: c.source === 'project' ? 'custom' : c.kind === 'local' ? 'app' : '' }))
    if (atQuery !== undefined && !project) {
      return 'ideas.md'.includes(atQuery.toLowerCase()) ? [{ key: 'ideas.md', label: 'Ideas', hint: 'ideas.md', tag: '' }] : []
    }
    if (atQuery !== undefined && project) {
      const q = atQuery.toLowerCase()
      const titleOf = new Map<string, string>([
        ...project.chapters.flatMap((c) => c.scenes.map((s) => [s.path, `${c.title} › ${s.title}`] as [string, string])),
        ...project.bible.map((b) => [b.path, b.name] as [string, string])
      ])
      return [...project.files, ...(project.series?.files ?? [])]
        .filter((f) => !f.startsWith('.novel/sessions') && (f.toLowerCase().includes(q) || (titleOf.get(f) ?? '').toLowerCase().includes(q)))
        .slice(0, 12)
        .map((f) => ({ key: f, label: titleOf.get(f) ?? f, hint: f, tag: '' }))
    }
    return []
  }, [slashQuery, atQuery, commands, project, brainstorm])

  useEffect(() => setMenuIdx(0), [slashQuery, atQuery])

  const pick = (key: string) => {
    if (slashQuery !== undefined) set({ draft: `/${key} ` + draft.slice(caret) })
    else if (atMatch) {
      const start = caret - (atQuery?.length ?? 0) - 1
      const next = draft.slice(0, start) + `@${key} ` + draft.slice(caret)
      set({ draft: next })
    }
    requestAnimationFrame(() => {
      const el = ta.current
      if (el) {
        el.focus()
        const pos = el.value.length
        el.setSelectionRange(pos, pos)
        setCaret(pos)
      }
    })
  }

  // ---- submit ----
  const submit = async () => {
    const text = draft.trim()
    if (!text) return
    set({ draft: '' })
    const imgs = images
    setImages([])
    if (text.startsWith('/')) {
      const m = /^\/([\w-]+)\s*([\s\S]*)$/.exec(text)
      if (m) {
        const [, name, args] = m
        const cmd = commands.find((c) => c.name === name)
        if (cmd?.kind === 'local') return runLocal(name, args.trim())
        if (cmd) {
          const expanded = await api.commands.expand(name, args)
          if (expanded) return st().sendToEngine(expanded, { images: imgs, display: text })
        }
      }
    }
    await st().sendToEngine(text, { images: imgs })
  }

  const runLocal = async (name: string, args: string) => {
    const s = st()
    switch (name) {
      case 'help':
        return s.set({ dialog: 'help' })
      case 'clear':
        return s.newChat()
      case 'new':
        return s.set({ dialog: 'new' })
      case 'new-brainstorm':
        return s.startBrainstorm()
      case 'add-book':
        if (!s.project?.series) return s.pushNotice('This book is not part of a series. Use /make-series first.')
        if (!args) return s.pushNotice('Usage: /add-book <title>')
        return s.addBook(args)
      case 'make-series':
        if (!s.project) return
        if (s.project.series) return s.pushNotice('This book is already part of a series.')
        return s.set({ dialog: 'make-series' })
      case 'compact': {
        if (s.engine === 'claude' && s.started === 'claude') return s.sendToEngine('/compact', { display: '/compact' })
        const items = s.session.items
        await s.newChat()
        const lines = items.flatMap((i) => (i.kind === 'user' ? [`AUTHOR: ${i.text}`] : i.kind === 'assistant' ? [`ASSISTANT: ${i.text}`] : []))
        s.set({ handoff: lines.join('\n\n').slice(-12000) })
        return s.pushNotice('Started a fresh conversation; a condensed transcript will be passed along with your next message.')
      }
      case 'engine':
        if (args === 'claude' || args === 'codex') return s.switchEngine(args)
        return s.pushNotice('Usage: /engine claude | codex')
      case 'model':
        if (!args) return s.pushNotice(`Current model: ${s.prefs[s.engine].model}. Available: ${s.models[s.engine].join(', ')}`)
        await s.setModel(args)
        return s.pushNotice(`Model set to ${args}.`)
      case 'plan':
        await s.setMode(s.mode === 'plan' ? 'ask' : 'plan')
        return s.pushNotice(s.mode === 'plan' ? 'Plan mode off.' : 'Plan mode on: the AI will research and propose a plan without editing.')
      case 'snapshot': {
        if (!s.project) return s.pushNotice('Snapshots need a project.')
        const r = await api.snapshots.create(args || 'Manual snapshot')
        return s.pushNotice(r ? `Snapshot ${r.slice(0, 7)} saved.` : 'No changes since the last snapshot.')
      }
      case 'rewind':
        return s.set({ sidebar: 'snapshots' })
      case 'resume':
        return s.set({ sidebar: 'history' })
      case 'export': {
        if (!s.project) return s.pushNotice('Create the project first (Turn into a book).')
        if (['md', 'docx', 'epub', 'pdf'].includes(args)) {
          const r = await api.exporter.run(args as ExportFormat, false)
          if (r) s.pushNotice(`Exported ${r.words.toLocaleString()} words to ${r.file}`)
          return
        }
        return s.set({ dialog: 'export' })
      }
      case 'wordcount': {
        if (!s.project) return
        const p = s.project
        const lines = p.chapters.map((c) => `- ${c.title}: ${c.words.toLocaleString()}`).join('\n')
        return s.pushNotice(`Manuscript: ${p.totalWords.toLocaleString()} / ${p.config.targetWords.toLocaleString()} words\n${lines}`)
      }
      case 'goal': {
        const n = parseInt(args, 10)
        if (!n || !s.project) return s.pushNotice('Usage: /goal 1500 (inside a project)')
        await api.project.saveConfig({ ...s.project!.config, dailyGoal: n })
        return s.pushNotice(`Daily goal set to ${n.toLocaleString()} words.`)
      }
    }
  }

  const addFiles = async (files: FileList | File[]) => {
    const out: string[] = []
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue
      let p = ''
      try {
        p = api.app.pathForFile(f)
      } catch {
        /* pasted */
      }
      if (!p) p = await api.app.saveTempImage(f.name || 'pasted.png', await f.arrayBuffer())
      out.push(p)
    }
    if (out.length) setImages((x) => [...x, ...out])
  }

  const effortList = EFFORTS[engine]

  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      <div
        className="relative rounded-2xl border border-line-strong bg-raised transition-[border-color,box-shadow] focus-within:border-accent/50 focus-within:shadow-[0_0_0_3px_var(--accent-soft),var(--shadow-md)]"
        style={{ boxShadow: 'var(--shadow-md)' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void addFiles(e.dataTransfer.files)
        }}
      >
        {menu.length > 0 && (
          <div className="surface-pop anim-lift absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-y-auto rounded-xl p-1.5">
            {menu.map((m, i) => (
              <button
                key={m.key}
                className={`flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left ${i === menuIdx ? 'bg-panel2' : ''}`}
                onMouseEnter={() => setMenuIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(m.key)
                }}
              >
                <span className="shrink-0 font-medium text-fg">{m.label}</span>
                <span className="truncate text-[11.5px] text-faint">{m.hint}</span>
                {m.tag && <span className="ml-auto rounded bg-line px-1.5 text-[10px] text-muted">{m.tag}</span>}
              </button>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2">
            {images.map((p) => (
              <span key={p} className="flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-0.5 text-[11.5px]">
                <img src={`file:///${p.replace(/\\/g, '/')}`} className="h-5 w-5 rounded object-cover" alt="" />
                {p.split(/[\\/]/).pop()}
                <button onClick={() => setImages((x) => x.filter((y) => y !== p))}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          id="composer-input"
          ref={ta}
          rows={2}
          value={draft}
          placeholder={busy ? 'Queue a follow-up…' : brainstorm ? 'Tell me about the story you want to write…' : 'Ask, or type / for writing commands and @ to mention a file'}
          className="block w-full resize-none bg-transparent px-3.5 pb-1 pt-2.5 text-[13.5px] leading-relaxed outline-none placeholder:text-faint"
          onChange={(e) => {
            set({ draft: e.target.value })
            setCaret(e.target.selectionStart)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault()
              void addFiles(e.clipboardData.files)
            }
          }}
          onKeyDown={(e) => {
            if (menu.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                return setMenuIdx((i) => (i + 1) % menu.length)
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                return setMenuIdx((i) => (i - 1 + menu.length) % menu.length)
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && slashQuery !== undefined && menu[menuIdx]?.key !== slashQuery) || (e.key === 'Enter' && atQuery !== undefined)) {
                e.preventDefault()
                return pick(menu[menuIdx].key)
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            } else if (e.key === 'Escape' && busy) {
              e.preventDefault()
              void st().interrupt()
            }
          }}
        />
        {/* No overflow clipping here: the pickers' menus open upward out of this row. */}
        <div className="flex items-end gap-1 px-2 pb-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1">
          <Dropdown<PermissionMode> value={mode} up options={MODES} onChange={(m) => void st().setMode(m)} />
          <Dropdown<string>
            value={prefs[engine].model}
            up
            allowCustom="Custom model id…"
            label={
              <>
                <Cpu size={12} /> {prefs[engine].model === 'default' ? 'Default model' : prefs[engine].model}
              </>
            }
            options={models[engine].map((m) => ({ value: m, label: m === 'default' ? 'Default model' : m, hint: m === 'default' ? 'Use the engine/account default' : undefined }))}
            onChange={(m) => void st().setModel(m)}
          />
          <Dropdown<string>
            value={prefs[engine].effort}
            up
            align="right"
            label={<span>{prefs[engine].effort ? `Effort: ${prefs[engine].effort}` : 'Effort: auto'}</span>}
            options={effortList.map((e) => ({ value: e, label: e || 'Auto', hint: e ? undefined : 'Engine default (applies to new conversations)' }))}
            onChange={(eff) => {
              const p = { ...prefs, [engine]: { ...prefs[engine], effort: eff } }
              localStorage.setItem('novelcoder.enginePrefs', JSON.stringify(p))
              set({ prefs: p, started: null })
            }}
          />
          </div>
          <button
            className="icon-btn shrink-0"
            title="Attach images"
            onClick={async () => {
              const p = await api.app.pickImages()
              if (p.length) setImages((x) => [...x, ...p])
            }}
          >
            <Paperclip size={15} />
          </button>
          {busy && !draft.trim() ? (
            <button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-fg text-bg" title="Stop (Esc)" onClick={() => void st().interrupt()}>
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button className="btn-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border disabled:opacity-30 disabled:shadow-none" disabled={!draft.trim()} title="Send (Enter)" onClick={() => void submit()}>
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
