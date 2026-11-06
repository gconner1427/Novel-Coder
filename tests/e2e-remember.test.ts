// End-to-end (opt-in): the story bible's filter and folds, and chat settings and the window's maximized state survive quitting and reopening the app.
//   set E2E=1 && npm run build && npx vitest run tests/e2e-remember.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { _electron as electron } from 'playwright'
import { scaffoldSeries, upsertBibleEntry } from '@shared/project'

const SEEN_VERSION = JSON.parse(fs.readFileSync('package.json', 'utf8')).version as string
const E2E = process.env.E2E === '1'
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'novel-coder-shots')

describe.skipIf(!E2E)('remembered settings', () => {
  it('filters and folds the series bible, and remembers that, the chat mode and a maximized window after a restart', async () => {
    fs.mkdirSync(shots, { recursive: true })
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-e2e-remember-'))
    const root = scaffoldSeries(path.join(base, 'Lantern Saga'), { seriesTitle: 'Lantern Saga', firstBookTitle: 'The Lantern Orchard', author: 'Ada Writer', genre: 'Fantasy' })
    upsertBibleEntry(root, 'characters', 'Wren Hale', { summary: 'Recurring lead.' }, '', 'merge', 'series')
    upsertBibleEntry(root, 'characters', 'Old Maren', { summary: 'Only in book one.' }, '', 'merge', 'book')
    upsertBibleEntry(root, 'locations', 'The Lantern Orchard', { summary: 'Hillside orchard.' }, '', 'merge', 'book')
    const userData = path.join(base, 'userdata')
    fs.mkdirSync(userData)
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ lastSeenVersion: SEEN_VERSION, recent: [root], lastProject: root, theme: 'dark' }))
    const env = { ...process.env, NOVEL_CODER_USER_DATA: userData } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    const launch = async () => {
      const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env })
      const page = await app.firstWindow()
      await page.setViewportSize({ width: 1500, height: 920 })
      await page.waitForSelector('footer', { timeout: 30000 })
      return { app, page }
    }

    let { app, page } = await launch()
    page.setDefaultTimeout(5000)
    await page.click('button[title="Story Bible"]')
    const filter = (label: string) => page.locator('[role="radiogroup"] [role="radio"]', { hasText: label })
    const bible = page.locator('nav ~ div')
    await bible.locator('text=Old Maren').waitFor()
    expect(await bible.locator('text=Wren Hale').count()).toBe(1)

    // Series only: book entries disappear.
    await filter('Series').click()
    await bible.locator('text=Old Maren').waitFor({ state: 'detached' })
    expect(await bible.locator('text=Wren Hale').count()).toBe(1)
    // Book only.
    await filter('Book').click()
    await bible.locator('text=Wren Hale').waitFor({ state: 'detached' })
    expect(await bible.locator('text=Old Maren').count()).toBe(1)

    // Fold the Locations section away.
    await bible.locator('text=The Lantern Orchard').waitFor()
    await bible.locator('[aria-expanded]', { hasText: 'Locations' }).click()
    await bible.locator('text=The Lantern Orchard').waitFor({ state: 'detached' })
    // A search opens every section so no match is hidden.
    await page.fill('input[placeholder="Search the bible…"]', 'orchard')
    await bible.locator('text=The Lantern Orchard').waitFor()
    await page.fill('input[placeholder="Search the bible…"]', '')
    await bible.locator('text=The Lantern Orchard').waitFor({ state: 'detached' })
    await page.screenshot({ path: path.join(shots, '10-bible-filter.png') })

    // Full auto in the chat.
    await page.click('button:has-text("Ask before edits")')
    await page.getByText('Full auto', { exact: true }).last().click()
    await page.waitForSelector('footer >> text=Full auto')
    // Maximize the window before quitting.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true)
    await app.close()

    // Reopen: the mode, the bible filter and the fold are all as they were.
    ;({ app, page } = await launch())
    page.setDefaultTimeout(5000)
    await page.waitForSelector('footer >> text=Full auto')
    await page.click('button[title="Story Bible"]')
    expect(await filter('Book').getAttribute('aria-checked')).toBe('true')
    await page.locator('nav ~ div').locator('text=Old Maren').waitFor()
    expect(await page.locator('nav ~ div').locator('text=The Lantern Orchard').count()).toBe(0)
    // It reopens maximized, and still knows its normal size for when it's restored.
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize())
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false)
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'window-state.json'), 'utf8')).width).toBeGreaterThanOrEqual(980)
    await app.close()
  }, 120000)
})
