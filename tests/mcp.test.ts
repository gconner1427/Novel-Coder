// Spawns the built MCP server (out/main/mcp.js) exactly as the engines do and calls its tools.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { scaffoldProject, readScene } from '@shared/project'

const server = path.resolve('out/main/mcp.js')
let root: string
let client: Client

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
  return { text: r.content.map((c) => c.text).join('\n'), isError: r.isError }
}

beforeAll(async () => {
  if (!fs.existsSync(server)) throw new Error('Run `npm run build` first (out/main/mcp.js missing)')
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-mcp-'))
  scaffoldProject(root, { title: 'MCP Test Novel' })
  client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server, '--project', root] }))
})

afterAll(async () => {
  await client?.close()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('novel MCP server', () => {
  it('lists all novel tools', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    for (const n of ['project_overview', 'scene_list', 'scene_read', 'scene_write', 'scene_create', 'bible_list', 'bible_get', 'bible_search', 'bible_upsert', 'continuity_context', 'outline_get', 'outline_update', 'timeline_add', 'style_guide_get', 'word_count', 'report_write', 'snapshot_create'])
      expect(names).toContain(n)
  })

  it('writes and reads scenes, bible, timeline, reports', async () => {
    const ov = JSON.parse((await call('project_overview')).text)
    expect(ov.config.title).toBe('MCP Test Novel')
    const scene = ov.chapters[0].scenes[0].path

    const w = await call('scene_write', { path: scene, body: 'Rain fell on Mara.', status: 'drafted', summary: 'Rain.' })
    expect(w.isError).toBeFalsy()
    await call('scene_write', { path: scene, body: 'She did not move.', mode: 'append' })
    expect(readScene(root, scene).body).toContain('Rain fell on Mara.\n\nShe did not move.')
    expect(readScene(root, scene).meta.summary).toBe('Rain.')

    await call('bible_upsert', { kind: 'characters', name: 'Mara', fields: { eyes: 'green' }, body: 'Lead.' })
    expect(JSON.parse((await call('bible_get', { name: 'mara' })).text).fields.eyes).toBe('green')
    expect((await call('continuity_context', { path: scene })).text).toContain('eyes: green')

    await call('timeline_add', { when: 'Day 1', event: 'Rain begins' })
    expect(fs.readFileSync(path.join(root, 'bible/timeline.md'), 'utf8')).toContain('| Day 1 | Rain begins |')

    const rep = await call('report_write', { name: 'continuity', content: '# OK' })
    expect(rep.text).toMatch(/\.novel\/reports\/.*continuity\.md/)

    const created = JSON.parse((await call('scene_create', { chapterTitle: 'Second', title: 'Dawn' })).text)
    expect(created.created).toMatch(/^manuscript\/02-second\/01-dawn\.md$/)

    const wc = JSON.parse((await call('word_count')).text)
    expect(wc.total).toBe(8)

    expect((await call('snapshot_create', { message: 'test' })).text).toMatch(/Snapshot/)
  })

  it('reports standalone books as not in a series and updates config', async () => {
    expect((await call('series_overview')).text).toMatch(/not part of a series/)
    await call('project_update_config', { title: 'Renamed Novel', genre: 'Gothic' })
    const ov = JSON.parse((await call('project_overview')).text)
    expect(ov.config.title).toBe('Renamed Novel')
    expect(ov.config.genre).toBe('Gothic')
    expect(ov.series).toBeNull()
  })

  it('rejects paths outside the project', async () => {
    const r = await call('scene_read', { path: '../../etc/passwd' })
    expect(r.isError).toBe(true)
  })
})
