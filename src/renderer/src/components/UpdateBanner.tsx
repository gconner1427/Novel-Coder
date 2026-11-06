import { useEffect, useState } from 'react'
import { Download, RefreshCw, X, Sparkles, ExternalLink } from 'lucide-react'
import { api } from '../lib/api'
import type { UpdateStatus } from '@shared/types'

export const RELEASES_URL = 'https://github.com/gconner1427/Novel-Coder/releases'

/** Keeps the latest update status from the main process. */
export function useUpdateStatus(): UpdateStatus | null {
  const [s, setS] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    void api.updates.status().then(setS)
    return api.updates.onStatus(setS)
  }, [])
  return s
}

/** The bar across the top of the window when a new release is on GitHub. */
export function UpdateBanner() {
  const s = useUpdateStatus()
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (!s || !s.version) return null
  if (!['available', 'downloading', 'downloaded'].includes(s.state) && !(s.state === 'error' && s.version)) return null
  if (s.state === 'available' && dismissed === s.version) return null

  return (
    <div role="status" aria-live="polite" className="flex shrink-0 items-center gap-3 border-b border-accent/40 bg-accent/10 px-4 py-2 text-[13px]">
      <Sparkles size={15} className="shrink-0 text-accent" />
      {s.state === 'available' && (
        <>
          <span className="min-w-0 flex-1 truncate">
            <b>Novel Coder {s.version}</b> is available. You have {s.current}.
          </span>
          <button className="btn py-1 text-[12.5px]" onClick={() => void api.app.openExternal(`${RELEASES_URL}/tag/v${s.version}`)}>
            <ExternalLink size={13} /> What's new
          </button>
          <button className="btn btn-primary py-1 text-[12.5px]" onClick={() => void api.updates.download()}>
            <Download size={13} /> Update now
          </button>
          <button className="icon-btn" title="Remind me next time" aria-label="Dismiss" onClick={() => setDismissed(s.version!)}>
            <X size={14} />
          </button>
        </>
      )}
      {s.state === 'downloading' && (
        <>
          <span className="flex-1">
            Downloading Novel Coder {s.version}… {s.percent ?? 0}%
          </span>
          <span className="relative h-1.5 w-40 overflow-hidden rounded-full bg-line">
            <span className="absolute inset-y-0 left-0 rounded-full bg-accent transition-all" style={{ width: `${s.percent ?? 0}%` }} />
          </span>
        </>
      )}
      {s.state === 'downloaded' && (
        <>
          <span className="flex-1">
            <b>Novel Coder {s.version}</b> is ready. Restart to finish updating; your work is saved.
          </span>
          <button className="btn btn-primary py-1 text-[12.5px]" onClick={() => void api.updates.install()}>
            <RefreshCw size={13} /> Restart and update
          </button>
        </>
      )}
      {s.state === 'error' && (
        <>
          <span className="min-w-0 flex-1 truncate text-err">Update failed: {s.message}</span>
          <button className="btn py-1 text-[12.5px]" onClick={() => void api.updates.download()}>
            Try again
          </button>
          <button className="btn py-1 text-[12.5px]" onClick={() => void api.app.openExternal(`${RELEASES_URL}/latest`)}>
            Download from GitHub
          </button>
        </>
      )}
    </div>
  )
}
