import { useEffect, useState } from 'react'
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../store'
import { Modal } from './ui'
import { CHANGELOG, compareVersions, entriesSince, type ChangelogEntry } from '@shared/changelog'

/** Versions newer than this are listed when the pop-up opens on its own (undefined = only the current one). */
let since: string | undefined

/** Open the What's new pop-up. `fromVersion` lists everything after it; omit it for just this version. */
export function openWhatsNew(fromVersion?: string) {
  since = fromVersion
  useStore.getState().set({ dialog: 'whats-new' })
}

/** On launch: if this version hasn't been seen yet, show what's new since the last one seen. */
export async function showWhatsNewIfNew() {
  const st = useStore.getState()
  const settings = st.settings
  if (!settings) return
  const version = await api.app.version()
  if (settings.lastSeenVersion === version) return
  if (entriesSince(version, settings.lastSeenVersion).length === 0) {
    // Nothing written for this version (e.g. a development build): just remember it.
    st.set({ settings: await api.app.setSettings({ lastSeenVersion: version }) })
    return
  }
  openWhatsNew(settings.lastSeenVersion)
}

export function WhatsNewDialog({ onClose }: { onClose: () => void }) {
  const set = useStore((s) => s.set)
  const [version, setVersion] = useState<string | null>(null)
  const [showEarlier, setShowEarlier] = useState(false)
  useEffect(() => {
    void api.app.version().then(setVersion)
  }, [])

  const close = async () => {
    if (version) set({ settings: await api.app.setSettings({ lastSeenVersion: version }) })
    onClose()
  }

  if (!version) return null
  const shown = entriesSince(version, since)
  const list = shown.length ? shown : CHANGELOG.filter((e) => e.version === version)
  // Older versions not already listed, behind a toggle.
  const earlier = CHANGELOG.filter((e) => compareVersions(e.version, version) < 0 && !list.some((l) => l.version === e.version))

  return (
    <Modal
      title={list.length > 1 ? "What's new since you last updated" : `What's new in Novel Coder ${version}`}
      onClose={() => void close()}
      width={600}
      footer={
        <button className="btn btn-primary" autoFocus onClick={() => void close()}>
          Got it
        </button>
      }
    >
      <div data-testid="whats-new">
        {list.length === 0 && <p className="text-[13px] text-muted">There are no notes for version {version}.</p>}
        {list.map((e) => (
          <Entry key={e.version} e={e} heading={list.length > 1} />
        ))}
        {earlier.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <button className="flex items-center gap-1 text-[12.5px] text-muted hover:text-fg" onClick={() => setShowEarlier(!showEarlier)}>
              {showEarlier ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Earlier versions
            </button>
            {showEarlier && (
              <div className="mt-3 opacity-90">
                {earlier.map((e) => (
                  <Entry key={e.version} e={e} heading />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function Entry({ e, heading }: { e: ChangelogEntry; heading: boolean }) {
  return (
    <section className="mb-5 last:mb-0">
      {heading ? (
        <h3 className="mb-1 text-[14px] font-semibold">
          Version {e.version} <span className="font-normal text-muted">· {e.summary}</span>
        </h3>
      ) : (
        <p className="mb-3 text-[13px] text-muted">{e.summary}</p>
      )}
      <ul className="space-y-3">
        {e.items.map((it) => (
          <li key={it.title} className="flex gap-3">
            <Sparkles size={15} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <div className="text-[13.5px] font-semibold">{it.title}</div>
              <div className="text-[13px] leading-relaxed text-muted">{it.body}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
