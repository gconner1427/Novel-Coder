// What's new pop-up in the real app (opt-in):  set E2E=1 && npm run build && npx vitest run tests/e2e-whatsnew.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { CHANGELOG } from '@shared/changelog'

const E2E = process.env.E2E === '1'
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'novel-coder-shots')
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version as string
let app: ElectronApplication | undefined

async function launch(userData: string): Promise<Page> {
  const env = { ...process.env, NOVEL_CODER_USER_DATA: userData } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  const exe = process.env.E2E_EXE
  app = await electron.launch(exe ? { executablePath: exe, args: [], env } : { args: [path.resolve('out/main/index.js')], env })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1400, height: 900 })
  return page
}

const readSettings = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))

describe.skipIf(!E2E)("What's new pop-up", () => {
  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('shows on the first run of a new version, covering skipped versions, then not again', async () => {
    fs.mkdirSync(shots, { recursive: true })
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-whatsnew-'))
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ recent: [], lastSeenVersion: '0.1.1' }))

    let page = await launch(userData)
    const dlg = page.getByTestId('whats-new')
    await dlg.waitFor({ timeout: 15000 })
    const text = await dlg.innerText()
    expect(text).toContain(`Version ${version}`)
    expect(text).toContain('Version 0.1.2') // skipped version included
    expect(text).not.toContain('Version 0.1.1 ·') // already seen
    await page.screenshot({ path: path.join(shots, 'whatsnew-after-update.png') })
    await page.click('button:has-text("Got it")')
    await expect.poll(() => readSettings(userData).lastSeenVersion).toBe(version)
    await app!.close()

    // Same version again: no pop-up.
    page = await launch(userData)
    await page.waitForTimeout(2500)
    expect(await page.getByTestId('whats-new').count()).toBe(0)

    // Any time from Settings.
    await page.click('button[title^="Settings"]')
    await page.click("button:has-text(\"What's new in this version\")")
    await page.getByTestId('whats-new').waitFor({ timeout: 5000 })
    // The current version's own notes.
    expect(await page.getByTestId('whats-new').innerText()).toContain(CHANGELOG.find((e) => e.version === version)!.items[0].title)
    await page.click('button:has-text("Earlier versions")')
    expect(await page.getByTestId('whats-new').innerText()).toContain('Version 0.1.0')
    await page.screenshot({ path: path.join(shots, 'whatsnew-from-settings.png') })
  }, 90000)
})
