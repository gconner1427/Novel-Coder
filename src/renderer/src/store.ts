import { create } from 'zustand'
import type {
  AuthStatus,
  BrainstormSummary,
  IdeaFields,
  ChatItem,
  EngineEvent,
  EngineId,
  PermissionMode,
  ProjectSnapshot,
  SessionRecord,
  SessionSummary,
  SlashCommand
} from '@shared/types'
import { api, uid, type AppSettings, type ScaffoldOptions } from './lib/api'

export type SidebarTab = 'series' | 'manuscript' | 'bible' | 'outline' | 'files' | 'history' | 'snapshots' | 'reports'
export type Tab = { kind: 'file'; path: string } | { kind: 'progress' } | { kind: 'corkboard' } | { kind: 'settings' } | { kind: 'welcome' }
export type Dialog = null | 'new' | 'convert' | 'export' | 'settings' | 'help' | 'make-series' | 'whats-new'

export const tabKey = (t: Tab) => (t.kind === 'file' ? `file:${t.path}` : t.kind)

interface EnginePrefs {
  model: string
  effort: string
}

export interface BrainstormState {
  id: string
  title: string
  ideas: string
  fields: IdeaFields
}

interface State {
  settings: AppSettings | null
  project: ProjectSnapshot | null
  /** Set while chatting before any project exists. */
  brainstorm: BrainstormState | null
  brainstorms: BrainstormSummary[]
  auth: AuthStatus | null
  commands: SlashCommand[]
  sidebar: SidebarTab
  tabs: Tab[]
  active: string | null
  dialog: Dialog
  chatOnly: boolean
  editorHidden: boolean
  toast: { text: string; level: 'info' | 'error' } | null

  // chat
  session: SessionRecord
  sessions: SessionSummary[]
  engine: EngineId
  mode: PermissionMode
  prefs: Record<EngineId, EnginePrefs>
  models: Record<EngineId, string[]>
  started: EngineId | null
  busy: boolean
  todos: { text: string; status: 'pending' | 'in_progress' | 'completed' }[]
  usage: { input: number; output: number; cost: number }
  handoff: string | null
  draft: string

  set: (p: Partial<State>) => void
  notify: (text: string, level?: 'info' | 'error') => void
  openTab: (t: Tab) => void
  closeTab: (key: string) => void
  loadProject: (p: ProjectSnapshot) => Promise<void>
  refreshBrainstorms: () => Promise<void>
  startBrainstorm: (engine?: EngineId) => Promise<void>
  openBrainstorm: (id: string) => Promise<void>
  leaveBrainstorm: () => Promise<void>
  convertBrainstorm: (dir: string, opts: ScaffoldOptions) => Promise<void>
  openBook: (bookRoot: string) => Promise<void>
  addBook: (title: string) => Promise<void>
  makeSeries: (title: string, plannedBooks: number) => Promise<void>
  refreshSessions: () => Promise<void>
  newChat: () => Promise<void>
  resumeChat: (id: string) => Promise<void>
  switchEngine: (e: EngineId) => Promise<void>
  setMode: (m: PermissionMode) => Promise<void>
  setModel: (m: string) => Promise<void>
  sendToEngine: (text: string, opts?: { images?: string[]; display?: string; resend?: boolean }) => Promise<void>
  interrupt: () => Promise<void>
  onEngineEvent: (engine: EngineId, ev: EngineEvent) => void
  pushNotice: (text: string, level?: 'info' | 'error') => void
  resolvePermission: (id: string, decision: 'allow' | 'allowAlways' | 'deny', extra?: { answers?: Record<string, string>; message?: string; label?: string }) => void
  saveSession: () => void
}

const emptySession = (engine: EngineId): SessionRecord => ({
  id: uid(),
  title: 'New conversation',
  created: Date.now(),
  updated: Date.now(),
  engine,
  engineSessions: {},
  items: []
})

const PREFS_KEY = 'novelcoder.enginePrefs'
function loadPrefs(): Record<EngineId, EnginePrefs> {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '')
    if (p.claude && p.codex) return p
  } catch {
    /* ignore */
  }
  return { claude: { model: 'default', effort: '' }, codex: { model: 'default', effort: '' } }
}

const DEFAULT_MODELS: Record<EngineId, string[]> = {
  claude: ['default', 'fable', 'opus', 'sonnet', 'haiku'],
  codex: ['default', 'gpt-5.5', 'gpt-5.5-codex', 'gpt-5.5-mini']
}

/** Condensed transcript used when switching engines mid-conversation. */
function transcriptForHandoff(items: ChatItem[]): string {
  const lines: string[] = []
  for (const it of items) {
    if (it.kind === 'user') lines.push(`AUTHOR: ${it.text}`)
    else if (it.kind === 'assistant') lines.push(`ASSISTANT (${it.engine}): ${it.text}`)
    else if (it.kind === 'tool' && it.changes?.length) lines.push(`[edited ${it.changes.map((c) => c.path).join(', ')}]`)
  }
  let text = lines.join('\n\n')
  if (text.length > 14000) text = '…' + text.slice(-14000)
  return text
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * The message that started a resumed chat. If the engine can't find that chat on this device (for
 * example it was started on another computer and its transcript didn't come across), we start a fresh
 * session, hand over the saved conversation and resend this message, once.
 */
let pendingResume: { engine: EngineId; text: string; images?: string[]; display?: string } | null = null
const RESUME_FAILED = /no conversation found|conversation not found|session not found|thread not found|could not find|couldn't find|no rollout|does not exist|unknown (thread|session)|failed to (load|resume)|no such (thread|session)/i

export const useStore = create<State>((set, get) => ({
  settings: null,
  project: null,
  brainstorm: null,
  brainstorms: [],
  auth: null,
  commands: [],
  sidebar: 'manuscript',
  tabs: [{ kind: 'welcome' }],
  active: 'welcome',
  dialog: null,
  chatOnly: false,
  editorHidden: false,
  toast: null,

  session: emptySession('claude'),
  sessions: [],
  engine: 'claude',
  mode: 'ask',
  prefs: loadPrefs(),
  models: DEFAULT_MODELS,
  started: null,
  busy: false,
  todos: [],
  usage: { input: 0, output: 0, cost: 0 },
  handoff: null,
  draft: '',

  set: (p) => set(p),
  notify: (text, level = 'info') => {
    set({ toast: { text, level } })
    setTimeout(() => get().toast?.text === text && set({ toast: null }), level === 'error' ? 7000 : 3500)
  },

  openTab: (t) => {
    const key = tabKey(t)
    const tabs: Tab[] = get().tabs.filter((x) => x.kind !== 'welcome')
    if (!tabs.some((x) => tabKey(x) === key)) tabs.push(t)
    set({ tabs, active: key, editorHidden: false, chatOnly: false })
  },
  closeTab: (key) => {
    const tabs = get().tabs.filter((t) => tabKey(t) !== key)
    const active = get().active === key ? (tabs.length ? tabKey(tabs[tabs.length - 1]) : null) : get().active
    set({ tabs, active })
  },

  loadProject: async (p) => {
    const engine = p.config.defaultEngine ?? 'claude'
    set({
      project: p,
      brainstorm: null,
      engine,
      session: emptySession(engine),
      started: null,
      busy: false,
      todos: [],
      usage: { input: 0, output: 0, cost: 0 },
      handoff: null,
      sidebar: get().sidebar === 'series' && !p.series ? 'manuscript' : get().sidebar
    })
    const first = p.chapters[0]?.scenes[0]
    set({ tabs: first ? [{ kind: 'file', path: first.path }] : [{ kind: 'progress' }], active: first ? `file:${first.path}` : 'progress' })
    const [commands] = await Promise.all([api.commands.list(), get().refreshSessions()])
    set({ commands })
  },

  refreshSessions: async () => set({ sessions: await api.sessions.list() }),

  refreshBrainstorms: async () => set({ brainstorms: await api.brainstorm.list() }),

  startBrainstorm: async (engine) => {
    const e = engine ?? get().engine
    const b = await api.brainstorm.create(e)
    set({
      project: null,
      brainstorm: { id: b.meta.id, title: b.meta.title, ideas: b.ideas, fields: {} },
      engine: e,
      session: emptySession(e),
      started: null,
      busy: false,
      todos: [],
      handoff: null,
      dialog: null
    })
    set({ commands: await api.commands.list() })
    void get().refreshBrainstorms()
  },

  openBrainstorm: async (id) => {
    const b = await api.brainstorm.open(id)
    const ideas = await api.brainstorm.ideas(id)
    const engine = b.session?.engine ?? b.meta.engine
    set({
      project: null,
      brainstorm: { id, title: b.meta.title, ideas: b.ideas, fields: ideas?.fields ?? {} },
      engine,
      session: b.session ?? emptySession(engine),
      started: null,
      busy: false,
      todos: [],
      handoff: null
    })
    set({ commands: await api.commands.list() })
  },

  leaveBrainstorm: async () => {
    if (get().busy) await get().interrupt()
    await api.brainstorm.close()
    set({ brainstorm: null, session: emptySession(get().engine), started: null, busy: false })
    void get().refreshBrainstorms()
  },

  convertBrainstorm: async (dir, opts) => {
    const st = get()
    const b = st.brainstorm
    if (!b) return
    if (st.busy) await st.interrupt()
    const engine = st.engine
    const { project } = await api.brainstorm.convert(b.id, dir, opts)
    const transcript = transcriptForHandoff(st.session.items)
    await get().loadProject(project)
    // Keep the engine the author was brainstorming with, and carry the whole conversation over.
    set({ engine, handoff: transcript || null, dialog: null })
    // Setting up a project makes many small edits; don't make the author approve each one.
    // Everything is snapshotted, and the author can switch back from the mode picker at any time.
    if (get().mode === 'ask') {
      set({ mode: 'acceptEdits' })
      get().pushNotice('Auto-accepting edits while the AI sets up your project. Every change can be reverted, and you can switch back to "Ask before edits" in the mode picker.')
    }
    const prompt = await api.commands.expand('from-brainstorm', '')
    if (prompt) await get().sendToEngine(prompt, { display: 'Set up this project from our brainstorm' })
  },

  openBook: async (bookRoot) => {
    if (get().busy) await get().interrupt()
    await get().loadProject(await api.series.openBook(bookRoot))
  },

  addBook: async (title) => {
    if (get().busy) await get().interrupt()
    await get().loadProject(await api.series.addBook(title))
    get().notify(`Added "${title}" to the series.`)
  },

  makeSeries: async (title, plannedBooks) => {
    if (get().busy) await get().interrupt()
    await get().loadProject(await api.series.convert(title, plannedBooks))
    set({ sidebar: 'series', dialog: null })
    get().notify(`"${title}" created. This book is now Book 1.`)
  },

  newChat: async () => {
    if (get().busy) await get().interrupt()
    await api.engine.close()
    // In a brainstorm this restarts the conversation; ideas.md is kept.
    set({ session: emptySession(get().engine), started: null, todos: [], handoff: null, busy: false })
  },

  resumeChat: async (id) => {
    const s = await api.sessions.load(id)
    if (!s) return
    if (get().busy) await get().interrupt()
    await api.engine.close()
    set({ session: s, engine: s.engine, started: null, todos: [], busy: false, handoff: null })
  },

  switchEngine: async (e) => {
    if (e === get().engine) return
    if (get().busy) await get().interrupt()
    await api.engine.close()
    const { session } = get()
    const hasContext = session.items.some((i) => i.kind === 'user')
    // If the new engine already has its own session for this conversation, resume it; otherwise hand off context.
    const handoff = hasContext && !session.engineSessions[e] ? transcriptForHandoff(session.items) : null
    set({ engine: e, started: null, handoff, session: { ...session, engine: e } })
    get().pushNotice(`Switched to ${e === 'claude' ? 'Claude (Claude Code)' : 'Codex (ChatGPT)'}.${handoff ? ' The conversation so far will be handed over with your next message.' : ''}`)
  },

  setMode: async (m) => {
    set({ mode: m })
    if (get().started) await api.engine.setMode(m)
  },

  setModel: async (m) => {
    const { engine, prefs } = get()
    const next = { ...prefs, [engine]: { ...prefs[engine], model: m } }
    localStorage.setItem(PREFS_KEY, JSON.stringify(next))
    set({ prefs: next })
    if (get().started) await api.engine.setModel(m)
  },

  sendToEngine: async (text, opts = {}) => {
    const st = get()
    if (!st.project && !st.brainstorm) return
    const engine = st.engine
    try {
      if (st.started !== engine) {
        const resumeId = st.session.engineSessions[engine]
        pendingResume = resumeId ? { engine, text, images: opts.images, display: opts.display } : null
        await api.engine.start({ engine, model: st.prefs[engine].model, permissionMode: st.mode, effort: st.prefs[engine].effort || undefined }, resumeId)
        set({ started: engine })
      }
    } catch (e) {
      get().pushNotice(`Could not start ${engine}: ${(e as Error).message}`, 'error')
      return
    }
    let payload = text
    const handoff = get().handoff
    if (handoff) {
      payload = `(You are taking over this conversation from another AI engine. Here is the conversation so far for context:)\n\n<previous_conversation>\n${handoff}\n</previous_conversation>\n\n${text}`
      set({ handoff: null })
    }
    const session = get().session
    const items: ChatItem[] = opts.resend
      ? session.items
      : [...session.items, { kind: 'user', id: uid(), text: opts.display ?? text, images: opts.images, engine, ts: Date.now() }]
    const title = session.title === 'New conversation' ? (opts.display ?? text).replace(/\s+/g, ' ').slice(0, 70) : session.title
    set({ session: { ...session, items, title, updated: Date.now() }, busy: true })
    get().saveSession()
    await api.engine.send({ text: payload, images: opts.images })
  },

  interrupt: async () => {
    await api.engine.interrupt()
    set({ busy: false })
    get().pushNotice('Interrupted.')
  },

  pushNotice: (text, level = 'info') => {
    const s = get().session
    set({ session: { ...s, items: [...s.items, { kind: 'notice', id: uid(), text, level }] } })
  },

  resolvePermission: (id, decision, extra = {}) => {
    void api.engine.respond({ requestId: id, decision, answers: extra.answers, message: extra.message })
    const s = get().session
    const label = extra.label ?? (decision === 'deny' ? 'Denied' : decision === 'allowAlways' ? 'Always allowed' : 'Allowed')
    set({ session: { ...s, items: s.items.map((i) => (i.kind === 'permission' && i.id === id ? { ...i, resolved: label } : i)) } })
  },

  saveSession: () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      const s = get().session
      if (!s.items.some((i) => i.kind === 'user')) return
      const b = get().brainstorm
      if (b) {
        await api.brainstorm.saveSession(b.id, s)
        void get().refreshBrainstorms()
        return
      }
      if (!get().project) return
      await api.sessions.save(s)
      void get().refreshSessions()
    }, 400)
  },

  onEngineEvent: (engine, ev) => {
    if (engine !== get().engine && ev.type !== 'session') return
    // A resumed chat that this device doesn't have: carry on from the saved conversation instead.
    const failText = ev.type === 'error' ? ev.message : ev.type === 'done' && ev.isError ? ev.result ?? '' : ''
    if (pendingResume && pendingResume.engine === engine && failText && RESUME_FAILED.test(failText)) {
      const retry = pendingResume
      pendingResume = null
      const cur = get().session
      const history = cur.items.slice(0, -1) // everything before the message being resent
      set({
        started: null,
        busy: false,
        handoff: transcriptForHandoff(history) || null,
        session: { ...cur, engineSessions: { ...cur.engineSessions, [engine]: undefined } }
      })
      void api.engine.close()
      get().pushNotice(`This chat's ${engine === 'claude' ? 'Claude' : 'Codex'} session isn't on this device, so it was continued from the saved conversation.`)
      void get().sendToEngine(retry.text, { images: retry.images, display: retry.display, resend: true })
      return
    }
    // Once the engine replies, the resume worked.
    if (pendingResume && (ev.type === 'text-delta' || ev.type === 'text' || ev.type === 'tool-start' || (ev.type === 'done' && !ev.isError))) pendingResume = null
    const s = get().session
    const items = [...s.items]
    const findIdx = (pred: (i: ChatItem) => boolean) => {
      for (let i = items.length - 1; i >= 0; i--) if (pred(items[i])) return i
      return -1
    }
    let patch: Partial<State> = {}
    switch (ev.type) {
      case 'session': {
        const engineSessions = { ...s.engineSessions, [ev.engine]: ev.sessionId }
        set({ session: { ...s, engineSessions } })
        if (ev.models?.length) set({ models: { ...get().models, [ev.engine]: Array.from(new Set(['default', ...ev.models])) } })
        get().saveSession()
        return
      }
      case 'turn-start':
        set({ busy: true })
        return
      case 'text-delta':
      case 'text': {
        const i = findIdx((x) => x.kind === 'assistant' && x.id === ev.messageId)
        if (i >= 0) {
          const cur = items[i] as Extract<ChatItem, { kind: 'assistant' }>
          items[i] = { ...cur, text: ev.type === 'text' ? ev.text : cur.text + ev.text }
        } else items.push({ kind: 'assistant', id: ev.messageId, text: ev.text, engine, ts: Date.now() })
        break
      }
      case 'thinking': {
        const i = findIdx((x) => x.kind === 'thinking' && x.id === ev.messageId)
        if (i >= 0) {
          const cur = items[i] as Extract<ChatItem, { kind: 'thinking' }>
          items[i] = { ...cur, text: ev.delta ? cur.text + ev.text : ev.text }
        } else items.push({ kind: 'thinking', id: ev.messageId, text: ev.text })
        break
      }
      case 'tool-start':
        if (findIdx((x) => x.kind === 'tool' && x.id === ev.toolId) < 0)
          items.push({ kind: 'tool', id: ev.toolId, name: ev.name, input: ev.input, done: false, parentToolId: ev.parentToolId })
        break
      case 'tool-end': {
        const i = findIdx((x) => x.kind === 'tool' && x.id === ev.toolId)
        if (i >= 0) items[i] = { ...(items[i] as Extract<ChatItem, { kind: 'tool' }>), output: ev.output, isError: ev.isError, done: true }
        break
      }
      case 'file-change': {
        const i = findIdx((x) => x.kind === 'tool' && x.id === ev.toolId)
        if (i >= 0) {
          const cur = items[i] as Extract<ChatItem, { kind: 'tool' }>
          items[i] = { ...cur, changes: [...(cur.changes ?? []), { path: ev.path, kind: ev.kind, before: ev.before, after: ev.after }] }
        }
        break
      }
      case 'todos':
        set({ todos: ev.items })
        return
      case 'permission':
        items.push({ kind: 'permission', id: ev.requestId, tool: ev.tool, input: ev.input, permKind: ev.kind })
        break
      case 'usage': {
        const u = get().usage
        patch = { usage: { input: ev.inputTokens, output: u.output + ev.outputTokens, cost: ev.costUsd ?? u.cost } }
        break
      }
      case 'status':
        items.push({ kind: 'notice', id: uid(), text: ev.text, level: 'info' })
        break
      case 'done':
        patch = { ...patch, busy: false }
        if (ev.isError && ev.result) items.push({ kind: 'notice', id: uid(), text: ev.result, level: 'error' })
        // mark any dangling tools as finished
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          if (it.kind === 'tool' && !it.done) items[i] = { ...it, done: true }
        }
        if (ev.isError && ev.result === 'Claude session ended.') patch.started = null
        break
      case 'error':
        items.push({ kind: 'notice', id: uid(), text: ev.message, level: 'error' })
        patch = { ...patch, busy: false }
        break
    }
    set({ ...patch, session: { ...s, items, updated: Date.now() } })
    if (ev.type === 'done' || ev.type === 'error' || ev.type === 'tool-end') get().saveSession()
  }
}))
