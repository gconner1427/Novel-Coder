// End-to-end smoke test of the real Electron app (opt-in):  set E2E=1 && npm run build && npx vitest run tests/e2e.test.ts
// Set E2E_LIVE=1 as well to also send a chat message to the Claude engine.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { scaffoldProject, upsertBibleEntry, writeScene, readScene } from '@shared/project'

// Mark this version's What's new as seen, so the pop-up doesn't cover the window.
const SEEN_VERSION = JSON.parse(fs.readFileSync('package.json', 'utf8')).version as string

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
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ lastSeenVersion: SEEN_VERSION, recent: [root], lastProject: root, theme: 'dark' }))
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

  it('keeps the scene toolbar usable in a narrow window', async () => {
    await page.click('text=Dusk Harvest')
    const blocking = page.locator('button[title^="Check the scene\'s blocking"]')
    expect(await blocking.innerText()).toContain('Blocking')
    await page.setViewportSize({ width: 1100, height: 900 })
    await page.waitForTimeout(300)
    // Labels fold away; every button stays visible and clickable by its icon.
    for (const t of ['Continue writing', 'Line-edit', 'Check this scene against', "Check the scene's blocking"]) {
      const b = page.locator(`button[title^="${t}"]`)
      expect(await b.isVisible(), t).toBe(true)
      const box = (await b.boundingBox())!
      const bar = (await page.getByTestId('doc-toolbar').boundingBox())!
      expect(box.width, `${t} is not squashed`).toBeGreaterThan(20)
      // Inside the toolbar's visible area, not pushed past its edge.
      expect(box.x + box.width, `${t} fits in the toolbar`).toBeLessThanOrEqual(bar.x + bar.width + 1)
      expect(box.y + box.height, `${t} fits in the toolbar`).toBeLessThanOrEqual(bar.y + bar.height + 1)
      expect(await b.evaluate((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && el.contains(hit) }), `${t} is clickable`).toBe(true)
    }
    await page.screenshot({ path: path.join(shots, '02b-narrow-toolbar.png') })
    await page.setViewportSize({ width: 1500, height: 920 })
  })

  it('loads Codex models and filters effort choices using its runtime', async () => {
    const catalog = await page.evaluate(() => window.novel.engine.codexModels())
    // Codex can refresh its cached catalog between processes. Give the picker the exact
    // runtime snapshot checked here, rather than comparing two independent discoveries.
    await app.evaluate(({ ipcMain }, snapshot) => {
      ipcMain.removeHandler('engine:codexModels')
      ipcMain.handle('engine:codexModels', () => snapshot)
    }, catalog)
    await page.click('[role=radio]:has-text("Codex")')
    const defaultModel = catalog.models.find((m) => m.id === catalog.defaultModel)
    expect(defaultModel).toBeTruthy()
    await page.click('button:has-text("Default model")')
    await page.getByText(`Codex default: ${catalog.defaultModel}`, { exact: true }).waitFor()
    for (const model of catalog.models) expect(await page.getByText(model.displayName, { exact: true }).last().isVisible()).toBe(true)
    const modelMenu = page.locator('.surface-pop')
    await modelMenu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    await page.screenshot({ path: path.join(shots, '03c-codex-models.png') })
    expect(await modelMenu.locator('button').count(), JSON.stringify({ expected: catalog.models.map((m) => m.id), shown: await modelMenu.innerText() })).toBe(catalog.models.length + 1)
    await page.getByText(defaultModel!.displayName, { exact: true }).last().click()
    await page.click('button:has-text("Effort: auto")')
    const effortMenu = page.locator('.surface-pop')
    await effortMenu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    expect(await effortMenu.locator('button').count()).toBe(defaultModel!.supportedReasoningEfforts.length + 1)
    for (const effort of defaultModel!.supportedReasoningEfforts) expect(await effortMenu.getByText(effort.reasoningEffort, { exact: true }).isVisible()).toBe(true)
    await page.screenshot({ path: path.join(shots, '03d-codex-efforts.png') })
    const selectedEffort = defaultModel!.supportedReasoningEfforts.at(-1)!.reasoningEffort
    await effortMenu.getByText(selectedEffort, { exact: true }).click()
    const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('novelcoder.enginePrefs')!))
    expect(prefs.codex).toEqual({ model: defaultModel!.id, effort: selectedEffort })
    await page.click(`button:has-text("Effort: ${selectedEffort}")`)
    await page.locator('.surface-pop').getByText('Auto', { exact: true }).click()
    await page.click(`button:has-text("${defaultModel!.id}")`)
    await page.locator('.surface-pop').getByText('Default model', { exact: true }).click()
    await page.waitForSelector('footer >> text=Review only')
    await page.click('[role=radio]:has-text("Claude")')
  })

  it('shows Devices & AI memory in Settings and saves to the book', async () => {
    await page.click('button[title^="Settings"]')
    const box = page.getByTestId('devices')
    await box.waitFor({ timeout: 5000 })
    expect(await box.innerText()).toContain(os.hostname())
    await box.locator('button:has-text("Save now")').click()
    await page.waitForSelector('text=/Saved .* to the book|Everything was already saved/', { timeout: 10000 })
    expect(fs.existsSync(path.join(root, '.novel', 'ai', 'manifest.json'))).toBe(true)
    await page.keyboard.press('Escape')
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
      await page.waitForFunction(() => !!document.querySelector('[data-busy]'), null, { timeout: 30000 }).catch(() => {})
      await page.waitForFunction(() => !document.querySelector('[data-busy]'), null, { timeout: 240000 })
      const chat = await page.locator('aside').innerText()
      await page.screenshot({ path: path.join(shots, `06-chat-${engine.toLowerCase()}.png`) })
      expect(chat).toMatch(/project overview|bible/i) // used the novel MCP tools
      expect(chat).toMatch(/Wren/)
      expect(chat).not.toMatch(/requires approval|isn.t logged in/)
    }, 300000)
  }

  it('shows tables (like the timeline) and keeps them when the file is edited', async () => {
    const rel = 'bible/timeline.md'
    const rows = [
      ['About 2020–21 (seventh grade)', 'A teacher times Wren twice because he thinks he hit the button wrong.', 'Ch. 1, Sc. 2 (mentioned)'],
      ['Wednesday, March 4, 6:51 a.m.', "Wren wakes in the orchard & counts \"one hundred\" lanterns; she's late.", 'Ch. 1, Sc. 1 & 4']
    ]
    const table = (title: string) => `## ${title}\n\n| When | Event | Chapter |\n|------|-------|---------|\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`
    fs.writeFileSync(path.join(root, rel), `# Timeline for this book\n\nSeries-wide events go elsewhere.\n\n${table('Before Chapter 1')}\n${table('Chapter 1')}`)
    await page.click('button[title="Story Bible"]')
    await page.click('text=Timeline')
    await page.waitForSelector('.ProseMirror table', { timeout: 10000 })
    expect(await page.locator('.ProseMirror table').count()).toBe(2)
    expect(await page.getByTestId('plain-text-notice').count()).toBe(0)
    expect(await page.locator('.ProseMirror').innerText()).toContain('counts "one hundred" lanterns')
    await page.screenshot({ path: path.join(shots, '06c-timeline-tables.png') })
    // Edit the text above the tables; the saved file must still have every row, with "&" left as "&".
    await page.locator('.ProseMirror p', { hasText: 'Series-wide' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Edited here.')
    await expect.poll(() => fs.readFileSync(path.join(root, rel), 'utf8'), { timeout: 5000 }).toContain('Edited here.')
    const saved = fs.readFileSync(path.join(root, rel), 'utf8')
    for (const r of rows) for (const cell of r) expect(saved).toContain(cell)
    expect(saved).not.toContain('&amp;')
    expect(saved.match(/\| When/g)).toHaveLength(2)
  })

  it('opens files with formatting the editor cannot show as plain text, so nothing is lost', async () => {
    const rel = 'notes/odd.md'
    fs.writeFileSync(path.join(root, rel), '# Odd note\n\nBefore.\n\n<!-- a hidden reminder for later -->\n\n- [ ] a task list item\n')
    await page.click('button[title="Outline"]')
    await page.click('text=Odd')
    await page.getByTestId('plain-text-notice').waitFor({ timeout: 10000 })
    const box = page.getByTestId('plain-text-editor')
    expect(await box.inputValue()).toContain('<!-- a hidden reminder for later -->')
    await box.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\nAdded line.')
    await expect.poll(() => fs.readFileSync(path.join(root, rel), 'utf8'), { timeout: 5000 }).toContain('Added line.')
    const saved = fs.readFileSync(path.join(root, rel), 'utf8')
    expect(saved).toContain('<!-- a hidden reminder for later -->')
    expect(saved).toContain('- [ ] a task list item')
  })

  it('reads the whole manuscript and a single chapter, and jumps back to edit a scene', async () => {
    await page.click('button[title="Manuscript"]')
    await page.click('button[title="Read the whole manuscript"]')
    const view = page.getByTestId('reading-view')
    await view.waitFor({ timeout: 10000 })
    await expect.poll(() => view.innerText()).toContain('lanterns woke')
    expect(await view.innerText()).toContain('The Lantern Orchard') // title page
    await page.screenshot({ path: path.join(shots, '06b-read-manuscript.png') })
    // One chapter, from the chapter row's read button.
    await page.locator('text=Chapter One').first().hover()
    await page.click('button[title="Read this chapter"]')
    await expect.poll(() => page.locator('[role=tab][aria-selected=true]').innerText()).toContain('Read: Chapter One')
    // Double-click a passage to edit its scene.
    await page.getByTestId('reading-view').locator('p', { hasText: 'lanterns woke' }).dblclick()
    await page.waitForSelector('.ProseMirror')
    expect(await page.locator('[role=tab][aria-selected=true]').innerText()).toContain('Dusk Harvest')
  })

  // Last: it closes the book.
  it('goes back to the library without losing what was just typed', async () => {
    await page.click('button[title="Manuscript"]')
    await page.click('text=Dusk Harvest')
    await page.locator('.ProseMirror p').last().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' She did not look back.')
    // Straight away, before the autosave delay has passed.
    await page.click('button:has-text("Library")')
    await page.waitForSelector('text=Your library', { timeout: 10000 })
    await expect.poll(() => readScene(root, 'manuscript/01-chapter-one/01-opening.md').body, { timeout: 5000 }).toContain('She did not look back.')
    await page.screenshot({ path: path.join(shots, '07-library.png') })
    // And back into the book from its cover.
    await page.click('button[title^="Open The Lantern Orchard"]')
    await page.waitForSelector('.ProseMirror', { timeout: 10000 })
  })
})
