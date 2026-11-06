// In-app update check against the real GitHub releases (opt-in, packaged builds only):
//   set E2E_UPDATE=up-to-date  && set E2E_EXE=dist\win-unpacked\NovelCoder.exe          -> Settings says up to date
//   set E2E_UPDATE=available   && set E2E_EXE=<an older packaged build>\NovelCoder.exe  -> banner, download, ready to restart
// It never clicks "Restart and update", so nothing is installed.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'

const MODE = process.env.E2E_UPDATE
const EXE = process.env.E2E_EXE
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'novel-coder-shots')
let app: ElectronApplication
let page: Page

describe.skipIf(!MODE || !EXE)('in-app updates', () => {
  beforeAll(async () => {
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
    await app?.close()
  })

  it.runIf(MODE === 'up-to-date')('reports the installed version as current', async () => {
    await page.click('button[title^="Settings"]')
    await page.click('button:has-text("Check for updates")')
    const line = page.getByTestId('update-line')
    await expect.poll(async () => line.innerText(), { timeout: 60000 }).toMatch(/up to date/i)
    await page.screenshot({ path: path.join(shots, 'update-uptodate.png') })
  }, 90000)

  it.runIf(MODE === 'available')('shows the banner on launch and downloads the update', async () => {
    // Checked automatically when the app opens.
    await page.waitForSelector('text=/Novel Coder \\d+\\.\\d+\\.\\d+ is available/', { timeout: 60000 })
    await page.screenshot({ path: path.join(shots, 'update-available.png') })
    await page.click('button:has-text("Update now")')
    await page.waitForSelector('text=/Downloading Novel Coder/', { timeout: 30000 })
    await page.screenshot({ path: path.join(shots, 'update-downloading.png') })
    await page.waitForSelector('button:has-text("Restart and update")', { timeout: 15 * 60 * 1000 })
    await page.screenshot({ path: path.join(shots, 'update-ready.png') })
    expect(await page.locator('text=/is ready/').count()).toBeGreaterThan(0)
  }, 16 * 60 * 1000)
})
