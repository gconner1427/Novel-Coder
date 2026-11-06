// Responsiveness while the AI edits the open scene, in a series book (opt-in):
//   set E2E=1 && npm run build && npx vitest run tests/e2e-responsiveness.test.ts
// Add E2E_LIVE=1 to also have Claude edit the open scene and check the page updates without a restart.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { scaffoldSeries, addBookToSeries, createChapter, createScene, writeScene, upsertBibleEntry } from '@shared/project'

const E2E = process.env.E2E === '1'
const SEEN_VERSION = JSON.parse(fs.readFileSync('package.json', 'utf8')).version as string
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'novel-coder-shots')
let app: ElectronApplication
let page: Page
let book1: string

const prose = (n: number) => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1}. The rain came down on the academy roof and nobody slept.`).join('\n\n')

describe.skipIf(!E2E)('responsiveness in a series book', () => {
  beforeAll(async () => {
    fs.mkdirSync(shots, { recursive: true })
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-resp-'))
    const series = path.join(base, 'Big Series')
    book1 = scaffoldSeries(series, { seriesTitle: 'Big Series', firstBookTitle: 'Book One' })
    // A realistic amount of material: three books, several chapters of long scenes, a full bible.
    const books = [book1, addBookToSeries(series, 'Book Two'), addBookToSeries(series, 'Book Three')]
    for (const b of books)
      for (let c = 0; c < 6; c++) {
        const ch = c === 0 ? '01-chapter-one' : createChapter(b, `Chapter ${c + 1}`)
        for (let s = 0; s < 4; s++) {
          const rel = c === 0 && s === 0 ? `manuscript/${ch}/01-opening.md` : createScene(b, ch, `Scene ${s + 1}`)
          writeScene(b, rel, { status: 'drafted', summary: `Scene ${s + 1} of chapter ${c + 1}.` }, prose(60))
        }
      }
    for (let i = 0; i < 40; i++) upsertBibleEntry(book1, 'characters', `Character ${i}`, { summary: 'Someone at the academy.' }, 'Notes.', 'merge', 'series')
    writeScene(book1, 'manuscript/01-chapter-one/01-opening.md', { title: 'Opening' }, 'Mara looked up at the tower.')
    const userData = path.join(base, 'userdata')
    fs.mkdirSync(userData)
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ lastSeenVersion: SEEN_VERSION, recent: [book1], lastProject: book1 }))
    const env = { ...process.env, NOVEL_CODER_USER_DATA: userData } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    const exe = process.env.E2E_EXE
    app = await electron.launch(exe ? { executablePath: exe, args: [], env } : { args: [path.resolve('out/main/index.js')], env })
    page = await app.firstWindow()
    await page.setViewportSize({ width: 1500, height: 920 })
    await page.waitForSelector('.ProseMirror', { timeout: 30000 })
    // Count how often the main process pushes a fresh copy of the whole book to the window.
    await page.evaluate(() => {
      const w = window as unknown as { __reloads: number; novel: { project: { onChanged: (cb: () => void) => void } } }
      w.__reloads = 0
      w.novel.project.onChanged(() => w.__reloads++)
    })
  }, 120000)

  afterAll(async () => {
    await app?.close()
  })

  it('does not keep reloading the book while nothing is happening', async () => {
    await page.waitForTimeout(1500)
    await page.evaluate(() => ((window as unknown as { __reloads: number }).__reloads = 0))
    await page.waitForTimeout(8000)
    const reloads = await page.evaluate(() => (window as unknown as { __reloads: number }).__reloads)
    expect(reloads, 'book reloads in 8 idle seconds').toBeLessThanOrEqual(1)
  }, 30000)

  it('reloads once when a scene changes on disk, and the open page shows the change', async () => {
    await page.evaluate(() => ((window as unknown as { __reloads: number }).__reloads = 0))
    writeScene(book1, 'manuscript/01-chapter-one/01-opening.md', {}, 'Mara looked up at the tower. A light came on in the highest window.')
    await page.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent?.includes('highest window'), null, { timeout: 5000 })
    await page.waitForTimeout(3000)
    const reloads = await page.evaluate(() => (window as unknown as { __reloads: number }).__reloads)
    expect(reloads, 'reloads after one edit').toBeLessThanOrEqual(2)
  }, 30000)

  it('opens another document promptly after an edit', async () => {
    await page.click('button[title="Story Bible"]')
    const t0 = Date.now()
    await page.click('text=Character 7')
    await page.waitForSelector('input[value="Character 7"]', { timeout: 5000 })
    expect(Date.now() - t0, 'ms to open a bible entry').toBeLessThan(2000)
    await page.click('button[title="Manuscript"]')
    await page.click('.ProseMirror') // focus back on page
  }, 30000)

  it.skipIf(process.env.E2E_LIVE !== '1')('shows an AI edit to the open scene without a restart, and other documents still open', async () => {
    await page.click('text=Dusk').catch(() => {})
    await page.click('text=Opening')
    await page.click('button:has-text("Ask before edits")')
    await page.getByText('Auto-accept edits', { exact: true }).last().click()
    await page.click('#composer-input')
    await page.keyboard.type(
      'Append exactly this sentence as a new final paragraph to the scene manuscript/01-chapter-one/01-opening.md, using the novel scene_write tool with mode append: "The bell in the tower rang thirteen times." Then reply "Done."'
    )
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent?.includes('thirteen times'), null, { timeout: 180000 })
    await page.waitForFunction(() => !document.body.innerText.includes('Working… (Esc to interrupt)'), null, { timeout: 180000 })
    // Other documents still open with content.
    await page.click('button[title="Story Bible"]')
    await page.click('text=Character 3')
    await page.waitForSelector('input[value="Character 3"]', { timeout: 5000 })
    await page.screenshot({ path: path.join(shots, 'resp-after-ai-edit.png') })
  }, 240000)
})
