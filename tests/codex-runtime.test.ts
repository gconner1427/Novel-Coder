// Metadata only: runs the bundled runtime without inference or account credentials.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { codexExe, getCodexAccount, getCodexCatalog } from '../src/main/services/codexRuntime'
import { getAuthStatus } from '../src/main/services/auth'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-codex-setup-'))

beforeAll(() => {
  const codexHome = path.join(root, 'codex')
  fs.mkdirSync(codexHome)
  fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "my-configured-model"\nmodel_reasoning_effort = "high"\n')
  vi.stubEnv('CODEX_HOME', codexHome)
})

afterAll(() => {
  vi.unstubAllEnvs()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('bundled Codex setup', () => {
  it('loads the actual model catalog and configured defaults', async () => {
    expect(fs.existsSync(codexExe()!)).toBe(true)
    const catalog = await getCodexCatalog(root)
    expect(catalog.models.length).toBeGreaterThan(0)
    expect(catalog.defaultModel).toBe('my-configured-model')
    expect(catalog.configuredEffort).toBe('high')
    for (const model of catalog.models) {
      expect(model.id).toBeTruthy()
      expect(model.supportedReasoningEfforts.map((e) => e.reasoningEffort)).toContain(model.defaultReasoningEffort)
    }
  })

  it('reports signed out without an account and does not trust an empty auth file', async () => {
    expect(await getCodexAccount()).toMatchObject({ loggedIn: false })
    fs.writeFileSync(path.join(process.env.CODEX_HOME!, 'auth.json'), '{}')
    expect((await getAuthStatus()).codex).toMatchObject({ installed: true, loggedIn: false })
    fs.unlinkSync(path.join(process.env.CODEX_HOME!, 'auth.json'))
  })

  it('surfaces invalid configuration so the picker can offer a retry', async () => {
    fs.writeFileSync(path.join(process.env.CODEX_HOME!, 'config.toml'), 'model = [')
    await expect(getCodexCatalog(root)).rejects.toThrow()
  })
})
