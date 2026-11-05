// Live E2E: brainstorm with no project → turn into a series → AI sets it up → add book 2 → Codex in book 2.
//   set E2E=1 && set E2E_LIVE=1 && npm run build && npx vitest run tests/e2e-brainstorm.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { listBible, listBooks, readText } from '@shared/project'

const RUN = process.env.E2E === '1' && process.env.E2E_LIVE === '1'
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'novel-coder-shots')
let app: ElectronApplication
let page: Page
let base: string

const waitIdle = async (timeout = 420000) => {
  await page.waitForFunction(() => document.body.innerText.includes('Working…'), null, { timeout: 30000 }).catch(() => {})
  await page.waitForFunction(() => !document.body.innerText.includes('Working… (Esc to interrupt)'), null, { timeout })
}

describe.skipIf(!RUN)('brainstorm → series flow', () => {
  beforeAll(async () => {
    fs.mkdirSync(shots, { recursive: true })
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-bs-'))
    const userData = path.join(base, 'userdata')
    fs.mkdirSync(userData)
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ recent: [], theme: 'dark' }))
    const env = { ...process.env, NOVEL_CODER_USER_DATA: userData } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    const exe = process.env.E2E_EXE
    app = await electron.launch(exe ? { executablePath: exe, args: [], env } : { args: [path.resolve('out/main/index.js')], env })
    page = await app.firstWindow()
    await page.setViewportSize({ width: 1500, height: 920 })
    // Stub the native folder picker so the dialog can be completed automatically.
    const target = path.join(base, 'projects')
    fs.mkdirSync(target)
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as never
    }, target)
    await page.waitForSelector('text=Brainstorm with Claude')
    await page.screenshot({ path: path.join(shots, 'b1-welcome.png') })
  }, 60000)

  afterAll(async () => {
    await app?.close()
  })

  it('brainstorms with Claude before any project exists', async () => {
    await page.click('button:has-text("Brainstorm with Claude")')
    await page.waitForSelector('text=Turn into a book')
    await page.click('#composer-input')
    await page.keyboard.type(
      "Let's lock this in quickly: a fantasy trilogy (3 books) called The Lantern Cycle, first person past tense. Premise: an orchard whose fruit holds the memories of the dead. Lead: Wren Hale, 17, an apprentice who can taste memories; antagonist: the Archivist. Please update ideas.md now with these decisions (fields and the Characters section), then reply in two sentences."
    )
    await page.keyboard.press('Enter')
    await waitIdle(240000)
    await page.waitForSelector('aside >> text=Lantern Cycle', { timeout: 30000 })
    await page.waitForSelector('text=Turn into a series')
    await page.screenshot({ path: path.join(shots, 'b2-brainstorm.png') })
  }, 300000)

  it('turns the brainstorm into a series and the AI builds it out', async () => {
    await page.click('button:has-text("Turn into a series")')
    await page.waitForSelector('text=Turn brainstorm into a project')
    expect(await page.inputValue('input[placeholder="The Lantern Cycle"]')).toMatch(/Lantern Cycle/)
    await page.fill('input[placeholder="Book one title"]', 'Dusk Harvest')
    await page.click('button:has-text("Browse")')
    await page.screenshot({ path: path.join(shots, 'b3-convert-dialog.png') })
    await page.click('button:has-text("Create series")')
    await page.waitForSelector('text=Set up this project from our brainstorm', { timeout: 30000 })
    await waitIdle(600000)
    await page.screenshot({ path: path.join(shots, 'b4-after-setup.png') })

    // The chosen folder was empty, so it becomes the series folder itself.
    const seriesRoot = path.join(base, 'projects')
    const books = listBooks(seriesRoot)
    expect(books.map((b) => b.title)).toEqual(['Dusk Harvest'])
    expect(readText(path.join(books[0].root, 'notes', 'brainstorm-ideas.md'))).toMatch(/Lantern Cycle/)
    const seriesBible = listBible(books[0].root, undefined, ['series']).map((e) => e.name)
    expect(seriesBible.join(' ')).toMatch(/Wren/)
    expect(readText(path.join(seriesRoot, 'series-outline.md')).length).toBeGreaterThan(400)
  }, 660000)

  it('adds book 2 from the Series panel', async () => {
    await page.click('button[title="Series"]')
    await page.waitForSelector('text=Add book 2')
    await page.screenshot({ path: path.join(shots, 'b5-series-panel.png') })
    await page.click('button:has-text("Add book 2")')
    await page.fill('input[placeholder="Title of book 2"]', 'Ember Archive')
    await page.keyboard.press('Enter')
    await page.waitForSelector('header >> text=Ember Archive')
    expect(await page.locator('header').innerText()).toMatch(/Book 2/)
  }, 60000)

  it('Codex in book 2 can see the shared series bible', async () => {
    await page.click('[role=radio]:has-text("Codex")')
    await page.click('#composer-input')
    await page.keyboard.type('Using the novel tools, list the recurring characters in the series bible. One short line.')
    await page.keyboard.press('Enter')
    await waitIdle(300000)
    const chat = await page.locator('aside').innerText()
    await page.screenshot({ path: path.join(shots, 'b6-codex-book2.png') })
    expect(chat).toMatch(/Wren/)
    expect(chat).not.toMatch(/requires approval/)
  }, 320000)
})
