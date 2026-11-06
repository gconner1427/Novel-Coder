// In-app update check against the real GitHub releases (opt-in, packaged builds only):
//   set E2E_UPDATE=up-to-date  && set E2E_EXE=dist\win-unpacked\NovelCoder.exe          -> Settings says up to date
//   set E2E_UPDATE=available   && set E2E_EXE=<an older packaged build>\NovelCoder.exe  -> banner, download, nothing installs on close
// It never clicks "Restart and update". It refuses to run while an installed Novel Coder is open,
// because an installer (if one ever ran) closes every running copy.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'

const MODE = process.env.E2E_UPDATE
const EXE = process.env.E2E_EXE
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'novel-coder-shots')
let app: ElectronApplication | undefined
let page: Page

/** Paths of every running NovelCoder.exe. */
function runningCopies(): string[] {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-Process NovelCoder -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }"], { encoding: 'utf8' })
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

/** The installed Novel Coder version from Windows' installed-apps list, if any. */
function installedVersion(): string | null {
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', "Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Get-ItemProperty | Where-Object { $_.DisplayName -like 'Novel Coder*' } | ForEach-Object { $_.DisplayVersion }"],
      { encoding: 'utf8' }
    )
    return out.trim() || null
  } catch {
    return null
  }
}

describe.skipIf(!MODE || !EXE)('in-app updates', () => {
  beforeAll(async () => {
    const others = runningCopies().filter((p) => path.resolve(p) !== path.resolve(EXE!))
    if (others.length) throw new Error(`Close Novel Coder before running this test (open: ${others.join(', ')}).`)
    fs.mkdirSync(shots, { recursive: true })
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-update-'))
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ recent: [] }))
    const env = { ...process.env, NOVEL_CODER_USER_DATA: userData } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ executablePath: EXE!, args: [], env })
    page = await app.firstWindow()
    await page.setViewportSize({ width: 1400, height: 900 })
  }, 60000)

  afterAll(async () => {
    await app?.close().catch(() => {})
  }, 30000)

  it.runIf(MODE === 'up-to-date')('reports the installed version as current', async () => {
    await page.click('button[title^="Settings"]')
    await page.click('button:has-text("Check for updates")')
    const line = page.getByTestId('update-line')
    await expect.poll(async () => line.innerText(), { timeout: 60000 }).toMatch(/up to date/i)
    await page.screenshot({ path: path.join(shots, 'update-uptodate.png') })
  }, 90000)

  it.runIf(MODE === 'available')('shows the banner, downloads, and installs nothing when closed', async () => {
    const before = installedVersion()
    // Checked automatically when the app opens.
    await page.waitForSelector('text=/Novel Coder \\d+\\.\\d+\\.\\d+ is available/', { timeout: 60000 })
    await page.screenshot({ path: path.join(shots, 'update-available.png') })
    await page.click('button:has-text("Update now")')
    await page.waitForSelector('text=/Downloading Novel Coder/', { timeout: 30000 })
    await page.waitForSelector('button:has-text("Restart and update")', { timeout: 15 * 60 * 1000 })
    await page.screenshot({ path: path.join(shots, 'update-ready.png') })
    expect(await page.locator('text=/is downloaded/').count()).toBeGreaterThan(0)

    // Close without choosing Restart and update: no installer may run.
    await app!.close()
    app = undefined
    await new Promise((r) => setTimeout(r, 20000))
    const installers = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-Process | Where-Object { $_.ProcessName -like 'Novel-Coder-Setup*' -or $_.Path -like '*novel-coder-updater*' } | ForEach-Object { $_.ProcessName }"], { encoding: 'utf8' }).trim()
    expect(installers, 'an installer started after closing').toBe('')
    expect(installedVersion(), 'the installed version changed').toBe(before)
  }, 16 * 60 * 1000)
})
