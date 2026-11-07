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

  it('creates a universe, adds a standalone novella, moves between books and links a crossover', async () => {
    fs.mkdirSync(shots, { recursive: true })
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-e2e-universe-new-'))
    const userData = path.join(base, 'userdata')
    fs.mkdirSync(userData)
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ lastSeenVersion: SEEN_VERSION, recent: [], theme: 'dark' }))
    const target = path.join(base, 'projects')
    fs.mkdirSync(target)
    const env = { ...process.env, NOVEL_CODER_USER_DATA: userData } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env })
    try {
      const page = await app.firstWindow()
      await page.setViewportSize({ width: 1500, height: 920 })
      await app.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as never
      }, target)
      page.setDefaultTimeout(8000)
      const title = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())

      // New universe, starting with a series
      await page.click('button:has-text("New novel, series or universe")')
      await page.click('button:has-text("Many series, one world")')
      await page.fill('input[placeholder="The Vanguard Universe"]', 'The Vanguard Universe')
      await page.fill('input[placeholder="The Lantern Cycle"]', 'Iron Saint')
      await page.fill('input[placeholder="Book one title"]', 'Origin of Iron')
      await page.click('button:has-text("Browse")')
      await page.screenshot({ path: path.join(shots, '22-new-universe.png') })
      await page.click('button:has-text("Create universe")')
      await page.waitForSelector('footer', { timeout: 30000 })
      await expect.poll(title).toContain('Origin of Iron · Iron Saint · The Vanguard Universe')
      expect(fs.existsSync(path.join(target, 'universe.json'))).toBe(true)
      expect(fs.existsSync(path.join(target, 'Iron Saint', 'series.json'))).toBe(true)

      // The Universe tab replaces the Series tab
      expect(await page.locator('button[title="Series"]').count()).toBe(0)
      await page.click('button[title="Universe"]')
      const panel = page.getByTestId('universe-panel')
      await panel.locator('text=Iron Saint').first().waitFor()

      // A standalone novella
      await panel.locator('button', { hasText: 'New standalone' }).click()
      await panel.locator('input[placeholder="The Long Night"]').fill('The Long Night')
      await panel.locator('select').selectOption('novella')
      await panel.locator('button', { hasText: 'Create and open' }).click()
      await expect.poll(title).toContain('The Long Night · The Vanguard Universe')
      const novella = path.join(target, 'The Long Night')
      expect(JSON.parse(fs.readFileSync(path.join(novella, 'novel.json'), 'utf8'))).toMatchObject({ format: 'novella', targetWords: 30000 })
      await page.getByTestId('universe-panel').locator('text=Novella').first().waitFor()

      // Back to the series book through the universe tree
      await page.getByTestId('universe-panel').locator('button[aria-expanded]', { hasText: 'Iron Saint' }).click()
      await page.getByTestId('universe-panel').locator('button', { hasText: 'Origin of Iron' }).click()
      await expect.poll(title).toContain('Origin of Iron · Iron Saint')

      // Make it part 1 of a crossover in the book's settings
      await page.keyboard.press('Control+,')
      await page.fill('input[placeholder="Not part of a crossover"]', 'Blackout')
      await page.click('button:has-text("Save changes")')
      const book = path.join(target, 'Iron Saint', fs.readdirSync(path.join(target, 'Iron Saint')).find((d) => /^01-/.test(d))!)
      await expect.poll(() => JSON.parse(fs.readFileSync(path.join(book, 'novel.json'), 'utf8')).crossover).toEqual({ event: 'Blackout', part: 1 })
      await page.keyboard.press('Escape')
      await page.click('button[title="Universe"]')
      await page.getByTestId('universe-panel').locator('text=Blackout').first().waitFor()
      await page.screenshot({ path: path.join(shots, '23-universe-panel.png') })
      // The other books' instructions now list the crossover's part
      await expect.poll(() => fs.readFileSync(path.join(book, 'AGENTS.md'), 'utf8')).toContain('part 1 of the crossover event "Blackout"')

      // Library covers name the universe; opening the universe folder itself opens its most recent book
      await page.click('button:has-text("Library")')
      await page.locator('text=Your library').waitFor()
      expect(await page.locator('text=The Vanguard Universe').count()).toBeGreaterThan(0)
      await page.screenshot({ path: path.join(shots, '24-universe-library.png') })
      await page.locator('button', { hasText: 'Open novel' }).first().click()
      await expect.poll(title).toContain('Origin of Iron · Iron Saint · The Vanguard Universe')
    } finally {
      await app.close()
    }
  }, 120000)
})
