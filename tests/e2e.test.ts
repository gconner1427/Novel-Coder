// End-to-end smoke test of the real Electron app (opt-in):  set E2E=1 && npm run build && npx vitest run tests/e2e.test.ts
// Set E2E_LIVE=1 as well to also send a chat message to the Claude engine.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { scaffoldProject, upsertBibleEntry, writeScene, readScene } from '@shared/project'

const E2E = process.env.E2E === '1'
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'novel-coder-shots')
let app: ElectronApplication
let page: Page
let root: string

describe.skipIf(!E2E)('Novel Coder app', () => {
  beforeAll(async () => {
    fs.mkdirSync(shots, { recursive: true })
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-e2e-'))
    root = path.join(base, 'The Lantern Orchard')
    scaffoldProject(root, { title: 'The Lantern Orchard', author: 'Ada Writer', genre: 'Fantasy', premise: 'An orchard whose fruit glows with the memories of the dead.' })
    upsertBibleEntry(root, 'characters', 'Wren Hale', { aliases: ['Wren'], role: 'protagonist', age: 17, summary: 'Orchard-keeper’s apprentice who can taste memories.' }, 'Quiet, stubborn, afraid of the dark.')
    upsertBibleEntry(root, 'locations', 'The Lantern Orchard', { summary: 'Hillside orchard where the fruit glows at dusk.' })
    writeScene(root, 'manuscript/01-chapter-one/01-opening.md', { title: 'Dusk Harvest', status: 'drafted', pov: 'Wren Hale', summary: 'Wren picks her first memory-fruit.' },
      'The lanterns woke one by one as the sun slid behind the hill.\n\nWren held her breath and reached for the brightest pear.')
    const userData = path.join(base, 'userdata')
    fs.mkdirSync(userData)
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ recent: [root], lastProject: root, theme: 'dark' }))
    const env = { ...process.env, NOVEL_CODER_USER_DATA: userData } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE // set by VS Code-hosted terminals; would start Electron as plain Node
    const exe = process.env.E2E_EXE // e.g. dist/win-unpacked/NovelCoder.exe to test the packaged build
    app = await electron.launch(exe ? { executablePath: exe, args: [], env } : { args: [path.resolve('out/main/index.js')], env })
    page = await app.firstWindow()
    await page.setViewportSize({ width: 1500, height: 920 })
    await page.waitForSelector('text=Dusk Harvest', { timeout: 30000 })
  }, 60000)

  afterAll(async () => {
    await app?.close()
  })

  it('opens the project with manuscript, scene editor and chat', async () => {
    await page.waitForSelector('.ProseMirror')
    expect(await page.locator('.ProseMirror').innerText()).toContain('lanterns woke')
    await page.screenshot({ path: path.join(shots, '01-main.png') })
  })

  it('autosaves edits typed in the prose editor', async () => {
    await page.locator('.ProseMirror p').last().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' The pear was warm, like a held hand.')
    await page.waitForTimeout(1500)
    expect(readScene(root, 'manuscript/01-chapter-one/01-opening.md').body).toContain('like a held hand')
  })

  it('shows the story bible and opens an entry', async () => {
    await page.click('button[title="Story Bible"]')
    await page.click('text=Wren Hale')
    await page.waitForSelector('input[value="Wren Hale"]')
    await page.screenshot({ path: path.join(shots, '02-bible.png') })
  })

  it('shows slash commands in the composer', async () => {
    await page.click('#composer-input')
    await page.keyboard.type('/con')
    await page.waitForSelector('text=/continuity')
    await page.screenshot({ path: path.join(shots, '03-slash.png') })
    await page.fill('#composer-input', '')
  })

  it('opens and uses the mode, model and effort pickers', async () => {
    // Each picker's menu must be visible and clickable (it opens upward out of the composer).
    page.setDefaultTimeout(5000)
    const pick = async (trigger: string, option: string) => {
      await page.click(`button:has-text("${trigger}")`)
      // Exact match, so "high" doesn't also hit "xhigh".
      const opt = page.getByText(option, { exact: true }).last()
      await opt.waitFor({ state: 'visible', timeout: 3000 })
      expect(await opt.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return !!hit && el.contains(hit)
      }), `${option} is not covered or clipped`).toBe(true)
      await opt.click()
    }
    await pick('Ask before edits', 'Plan mode')
    await page.waitForSelector('footer >> text=Plan mode')
    await pick('Plan mode', 'Ask before edits')
    await pick('Default model', 'sonnet')
    await page.waitForSelector('button:has-text("sonnet")')
    await pick('sonnet', 'Default model')
    await pick('Effort: auto', 'high')
    await page.waitForSelector('button:has-text("Effort: high")')
    await page.screenshot({ path: path.join(shots, '03b-pickers.png') })
    await pick('Effort: high', 'Auto')
  })

  it('switches engines with the toggle', async () => {
    await page.click('[role=radio]:has-text("Codex")')
    expect(await page.locator('[role=radio][aria-checked=true]').innerText()).toContain('Codex')
    await page.click('[role=radio]:has-text("Claude")')
  })

  it('opens progress and corkboard views', async () => {
    await page.click('button[title="Open progress"]')
    await page.waitForSelector('text=Words per day')
    await page.screenshot({ path: path.join(shots, '04-progress.png') })
    await page.click('button[title="Manuscript"]')
    await page.click('button[title="Corkboard"]')
    await page.waitForSelector('text=Wren picks her first memory-fruit.')
    await page.screenshot({ path: path.join(shots, '05-corkboard.png') })
  })

  it('exports DOCX and EPUB', async () => {
    for (const f of ['docx', 'epub']) {
      const r = (await page.evaluate((fmt) => (window as never as { novel: { exporter: { run: (f: string, a: boolean) => Promise<{ file: string }> } } }).novel.exporter.run(fmt, false), f)) as { file: string }
      expect(fs.existsSync(r.file)).toBe(true)
    }
  })

  for (const engine of ['Claude', 'Codex']) {
    it.skipIf(process.env.E2E_LIVE !== '1')(`chats with ${engine} through the UI`, async () => {
      await page.click(`[role=radio]:has-text("${engine}")`)
      await page.click('button[title^="New conversation"]')
      await page.click('#composer-input')
      await page.keyboard.type('Using the novel tools, who is the protagonist of this book? Answer in one short sentence.')
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => document.body.innerText.includes('Working…'), null, { timeout: 30000 }).catch(() => {})
      await page.waitForFunction(() => !document.body.innerText.includes('Working… (Esc to interrupt)'), null, { timeout: 240000 })
      const chat = await page.locator('aside').innerText()
      await page.screenshot({ path: path.join(shots, `06-chat-${engine.toLowerCase()}.png`) })
      expect(chat).toMatch(/project overview|bible/i) // used the novel MCP tools
      expect(chat).toMatch(/Wren/)
      expect(chat).not.toMatch(/requires approval|isn.t logged in/)
    }, 300000)
  }
})
