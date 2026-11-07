// End-to-end (opt-in): a book in a shared universe sees the universe bible in the Story Bible panel,
// and the author can create their own bible categories there.
//   set E2E=1 && npm run build && npx vitest run tests/e2e-universe.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { _electron as electron } from 'playwright'
import { addSeriesToUniverse, addStandaloneToUniverse, listBibleCategories, listBible, scaffoldUniverse, upsertBibleEntry } from '@shared/project'

const SEEN_VERSION = JSON.parse(fs.readFileSync('package.json', 'utf8')).version as string
const E2E = process.env.E2E === '1'
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'novel-coder-shots')

describe.skipIf(!E2E)('universe in the app', () => {
  it('shows the universe bible layer and creates a custom category', async () => {
    fs.mkdirSync(shots, { recursive: true })
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-e2e-universe-'))
    const u = scaffoldUniverse(path.join(base, 'Vanguard'), { title: 'The Vanguard Universe', genre: 'Superhero' })
    const root = addSeriesToUniverse(u, { seriesTitle: 'Iron Saint', firstBookTitle: 'Origin of Iron' })
    addStandaloneToUniverse(u, { title: 'The Long Night', format: 'novella' })
    upsertBibleEntry(root, 'characters', 'Mara Voss', { summary: 'Crosses every series.' }, '', 'merge', 'universe')
    upsertBibleEntry(root, 'characters', 'Detective Hale', { summary: 'Iron Saint regular.' }, '', 'merge', 'series')
    upsertBibleEntry(root, 'characters', 'Old Maren', { summary: 'Only in book one.' }, '', 'merge', 'book')
    const userData = path.join(base, 'userdata')
    fs.mkdirSync(userData)
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ lastSeenVersion: SEEN_VERSION, recent: [root], lastProject: root, theme: 'dark' }))
    const env = { ...process.env, NOVEL_CODER_USER_DATA: userData } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env })
    try {
      const page = await app.firstWindow()
      await page.setViewportSize({ width: 1500, height: 920 })
      await page.waitForSelector('footer', { timeout: 30000 })
      page.setDefaultTimeout(5000)
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toContain('Origin of Iron · Iron Saint · The Vanguard Universe')

      await page.click('button[title="Story Bible"]')
      const bible = page.locator('nav ~ div')
      const filter = (label: string) => page.locator('[role="radiogroup"] [role="radio"]', { hasText: label })
      await bible.locator('text=Mara Voss').waitFor()
      expect(await bible.locator('text=Detective Hale').count()).toBe(1)
      expect(await bible.locator('text=Old Maren').count()).toBe(1)
      // Universe only
      await filter('Universe').click()
      await bible.locator('text=Old Maren').waitFor({ state: 'detached' })
      expect(await bible.locator('text=Detective Hale').count()).toBe(0)
      expect(await bible.locator('text=Mara Voss').count()).toBe(1)
      await page.screenshot({ path: path.join(shots, '20-universe-bible.png') })
      await filter('All').click()
      await bible.locator('text=Old Maren').waitFor()

      // A new category, added to the universe bible (the default when showing every layer)
      await bible.locator('button', { hasText: 'New category' }).click()
      await page.fill('input[placeholder^="Category name"]', 'Powers & Abilities')
      await page.keyboard.press('Enter')
      await bible.locator('[aria-expanded]', { hasText: 'Powers & Abilities' }).waitFor()
      await expect.poll(() => listBibleCategories(root).find((c) => c.slug === 'powers-abilities')?.scopes).toEqual(['universe'])
      expect(fs.existsSync(path.join(u, 'bible', 'powers-abilities', '_category.md'))).toBe(true)

      // An entry in it
      const header = bible.locator('[aria-expanded]', { hasText: 'Powers & Abilities' })
      await header.hover()
      await page.locator('button[title="New entry"]').click()
      await page.fill('input[placeholder="Entry name"]', 'Steel Skin')
      await page.keyboard.press('Enter')
      await bible.locator('text=Steel Skin').waitFor()
      await expect.poll(() => listBible(root, 'powers-abilities').map((e) => [e.name, e.scope])).toEqual([['Steel Skin', 'universe']])
      await page.screenshot({ path: path.join(shots, '21-universe-category.png') })
    } finally {
      await app.close()
    }
  }, 120000)
})
