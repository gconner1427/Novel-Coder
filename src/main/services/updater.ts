// In-app updates from the public GitHub releases (gconner1427/Novel-Coder).
// Checks when the app starts and every few hours; the user chooses when to download and restart.
import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

const { autoUpdater } = electronUpdater

const RECHECK_MS = 4 * 60 * 60 * 1000

let status: UpdateStatus = { state: 'idle', current: app.getVersion() }
let win: BrowserWindow | null = null
let checking: Promise<UpdateStatus> | null = null

function set(next: Partial<UpdateStatus>) {
  status = { ...status, ...next, current: app.getVersion() }
  win?.webContents.send('updates:status', status)
}

const releaseNotesText = (notes: unknown): string | undefined => {
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) return notes.map((n) => (n && typeof n === 'object' && 'note' in n ? String(n.note ?? '') : '')).join('\n\n')
  return undefined
}

export function setupUpdates(window: BrowserWindow) {
  win = window
  // Updates only make sense for the installed app; a dev build has nothing to replace.
  if (!app.isPackaged && !process.env.NOVEL_CODER_FORCE_UPDATES) {
    set({ state: 'unsupported', message: 'Updates are checked in the installed app.' })
    return
  }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: undefined }))
  autoUpdater.on('update-available', (info) =>
    set({ state: 'available', version: info.version, notes: releaseNotesText(info.releaseNotes), releaseDate: info.releaseDate, message: undefined })
  )
  autoUpdater.on('update-not-available', () => set({ state: 'none', checkedAt: Date.now(), message: undefined }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'downloaded', version: info.version, percent: 100 }))
  autoUpdater.on('error', (e) => set({ state: 'error', message: friendly(e) }))

  // Check every time the app opens, shortly after the window is up, then periodically.
  setTimeout(() => void checkForUpdates(), 4000)
  setInterval(() => void checkForUpdates(), RECHECK_MS).unref()
}

function friendly(e: unknown): string {
  const m = (e as Error)?.message ?? String(e)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|network/i.test(m)) return "Couldn't reach GitHub to check for updates. Check your internet connection."
  if (/404|Cannot find latest|No published versions/i.test(m)) return 'No published release was found on GitHub.'
  return m.split('\n')[0]
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (status.state === 'unsupported') return status
  if (status.state === 'downloading' || status.state === 'downloaded') return status
  if (checking) return checking
  checking = (async () => {
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      set({ state: 'error', message: friendly(e) })
    } finally {
      checking = null
    }
    return status
  })()
  return checking
}

export async function downloadUpdate(): Promise<void> {
  if (status.state !== 'available' && status.state !== 'error') return
  set({ state: 'downloading', percent: 0 })
  try {
    await autoUpdater.downloadUpdate()
  } catch (e) {
    set({ state: 'error', message: friendly(e) })
  }
}

/** Closes the app, runs the new installer silently, and reopens Novel Coder. */
export function installUpdate(beforeQuit?: () => void) {
  if (status.state !== 'downloaded') return
  beforeQuit?.()
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}

export const getUpdateStatus = () => status
