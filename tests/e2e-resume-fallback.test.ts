// Live E2E: a saved chat whose engine session isn't on this device (it was started elsewhere and its
// transcript didn't come across) still continues, from the saved conversation.
//   set E2E=1 && set E2E_LIVE=1 && npm run build && npx vitest run tests/e2e-resume-fallback.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { scaffoldProject } from '@shared/project'

const RUN = process.env.E2E === '1' && process.env.E2E_LIVE === '1'
const SEEN_VERSION = JSON.parse(fs.readFileSync('package.json', 'utf8')).version as string
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'novel-coder-shots')
let app: ElectronApplication
let page: Page

const savedChat = (id: string, engine: 'claude' | 'codex', word: string) => ({
  id,
  title: `Earlier ${engine} chat`,
  created: Date.now() - 3_600_000,
  updated: Date.now() - 3_600_000,
  engine,
  // A session id this device has never seen.
  engineSessions: { [engine]: crypto.randomUUID() },
  items: [
    { kind: 'user', id: 'u1', text: `Remember this code word for later: ${word}.`, engine, ts: Date.now() - 3_600_000 },
    { kind: 'assistant', id: 'a1', text: 'Noted.', engine, ts: Date.now() - 3_590_000 }
  ]
})

describe.skipIf(!RUN)('continuing a chat whose engine session is on another device', () => {
  beforeAll(async () => {
    fs.mkdirSync(shots, { recursive: true })
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-fallback-'))
    const root = path.join(base, 'Fallback Book')
    scaffoldProject(root, { title: 'Fallback Book' })
    const dir = path.join(root, '.novel', 'sessions')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'c1.json'), JSON.stringify(savedChat('c1', 'claude', 'PERIWINKLE-3')))
    fs.writeFileSync(path.join(dir, 'x1.json'), JSON.stringify(savedChat('x1', 'codex', 'SAFFRON-9')))
    const userData = path.join(base, 'userdata')
    fs.mkdirSync(userData)
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ lastSeenVersion: SEEN_VERSION, recent: [root], lastProject: root }))
    const env = { ...process.env, NOVEL_CODER_USER_DATA: userData } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    const exe = process.env.E2E_EXE
    app = await electron.launch(exe ? { executablePath: exe, args: [], env } : { args: [path.resolve('out/main/index.js')], env })
    page = await app.firstWindow()
    await page.setViewportSize({ width: 1500, height: 920 })
    await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  }, 60000)

  afterAll(async () => {
    await app?.close()
  })

  for (const [engine, word] of [
    ['claude', 'PERIWINKLE-3'],
    ['codex', 'SAFFRON-9']
  ] as const) {
    it(`${engine}: picks up from the saved conversation`, async () => {
      await page.click('button[title="Conversations"]')
      await page.click(`text=Earlier ${engine} chat`)
      await page.click('#composer-input')
      await page.keyboard.type('What was the code word I gave you earlier? Reply with just the code word.')
      await page.keyboard.press('Enter')
      await page.waitForSelector("text=/isn't on this device/", { timeout: 120000 })
      await page.waitForFunction((w) => document.body.innerText.includes(w), word, { timeout: 240000 })
      await page.waitForFunction(() => !document.body.innerText.includes('Working… (Esc to interrupt)'), null, { timeout: 240000 })
      await page.screenshot({ path: path.join(shots, `fallback-${engine}.png`) })
      const chat = await page.locator('aside').last().innerText()
      expect(chat).toContain(word)
    }, 300000)
  }
})
