/**
 * Paths the book watcher skips. Inside .novel/ only reports and custom commands matter to the window;
 * everything else there (stats, snapshots, sessions, AI sync) is the app's own bookkeeping, and
 * watching it made the app's own writes trigger endless reloads of the whole book.
 */
export function ignoredByWatcher(p: string): boolean {
  if (/[\\/](node_modules|\.git|exports)([\\/]|$)/.test(p)) return true
  const m = /[\\/]\.novel(?:[\\/]([^\\/]+))?/.exec(p)
  if (!m) return false
  if (!m[1]) return false // the .novel folder itself, so its reports/commands children are still visited
  return m[1] !== 'reports' && m[1] !== 'commands'
}
