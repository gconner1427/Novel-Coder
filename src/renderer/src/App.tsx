import { useEffect, useRef, useState } from 'react'
import { api } from './lib/api'
import { useStore } from './store'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/sidebar/Sidebar'
import { EditorPane } from './components/editor/EditorPane'
import { ChatPane } from './components/chat/ChatPane'
import { StatusBar } from './components/StatusBar'
import { Welcome } from './components/Welcome'
import { Dialogs } from './components/dialogs/Dialogs'
import { Toast } from './components/ui'
import { UpdateBanner } from './components/UpdateBanner'
import { BrainstormView } from './components/BrainstormView'

export default function App() {
  const project = useStore((s) => s.project)
  const brainstorm = useStore((s) => s.brainstorm)
  const settings = useStore((s) => s.settings)
  const chatOnly = useStore((s) => s.chatOnly)
  const editorHidden = useStore((s) => s.editorHidden)
  const [booted, setBooted] = useState(false)
  const [chatWidth, setChatWidth] = useState(() => Number(localStorage.getItem('novelcoder.chatWidth')) || 460)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // boot
  useEffect(() => {
    const st = useStore.getState()
    const offProject = api.project.onChanged((p) => useStore.setState({ project: p }))
    const offEngine = api.engine.onEvent(({ engine, ev }) => useStore.getState().onEngineEvent(engine, ev))
    const offIdeas = api.brainstorm.onChanged(({ id, text, fields }) => {
      const b = useStore.getState().brainstorm
      if (b?.id === id) useStore.setState({ brainstorm: { ...b, ideas: text, fields, title: fields.title || b.title } })
    })
    void st.refreshBrainstorms()
    void (async () => {
      const settings = await api.app.getSettings()
      st.set({ settings })
      api.auth.status().then((auth) => st.set({ auth }))
      let p = await api.project.current()
      if (!p && settings.lastProject) p = await api.project.open(settings.lastProject).catch(() => null)
      if (p) await st.loadProject(p)
      setBooted(true)
    })()
    return () => {
      offProject()
      offEngine()
      offIdeas()
    }
  }, [])

  // theme
  useEffect(() => {
    if (!settings) return
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings])

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState()
      if (e.ctrlKey && e.key.toLowerCase() === 'b' && !e.shiftKey) {
        e.preventDefault()
        setSidebarOpen((v) => !v)
      } else if (e.ctrlKey && e.key === '\\') {
        e.preventDefault()
        st.set({ editorHidden: !st.editorHidden })
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        st.set({ dialog: 'export' })
      } else if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        st.set({ dialog: 'settings' })
      } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        document.getElementById('composer-input')?.focus()
      } else if (e.key === 'Escape' && st.busy && !st.dialog) {
        void st.interrupt()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'n' && e.shiftKey) {
        e.preventDefault()
        void st.newChat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const dragging = useRef(false)
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return
      const w = Math.min(Math.max(window.innerWidth - e.clientX, 340), Math.max(window.innerWidth - 560, 360))
      setChatWidth(w)
    }
    const up = () => {
      if (dragging.current) localStorage.setItem('novelcoder.chatWidth', String(chatWidth))
      dragging.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [chatWidth])

  if (!booted) return <div className="h-full bg-bg drag" />

  return (
    <div className="flex h-full flex-col">
      <TitleBar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((v) => !v)} />
      <UpdateBanner />
      {brainstorm ? (
        <BrainstormView />
      ) : !project ? (
        <Welcome />
      ) : (
        <div className="flex min-h-0 flex-1">
          {sidebarOpen && !chatOnly && <Sidebar />}
          {!editorHidden && !chatOnly && (
            <main className="min-w-0 flex-1 border-l border-line">
              <EditorPane />
            </main>
          )}
          {!editorHidden && !chatOnly && (
            <div
              className="w-1 cursor-col-resize bg-line/40 hover:bg-accent/60"
              onMouseDown={() => {
                dragging.current = true
                document.body.style.cursor = 'col-resize'
              }}
            />
          )}
          <aside className="flex min-w-0 flex-col bg-panel" style={editorHidden || chatOnly ? { flex: 1 } : { width: chatWidth }}>
            <ChatPane wide={editorHidden || chatOnly} />
          </aside>
        </div>
      )}
      {project && <StatusBar />}
      <Dialogs />
      <Toast />
    </div>
  )
}
