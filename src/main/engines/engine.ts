import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { EngineEvent, EngineId, EngineSettings, PermissionMode, PermissionResponse, SendOptions } from '@shared/types'

export type Emit = (e: EngineEvent) => void

export interface EngineStartOptions {
  root: string
  settings: EngineSettings
  resumeSessionId?: string
  emit: Emit
  /** 'brainstorm' = no project yet: no novel MCP tools, ideation persona. */
  mode?: 'novel' | 'brainstorm'
  /** Extra folders the agent may read/write (the series folder for books in a series). */
  extraDirs?: string[]
}

/** Common interface implemented by the Claude and Codex adapters. */
export interface Engine {
  readonly id: EngineId
  send(msg: SendOptions): Promise<void>
  interrupt(): Promise<void>
  setPermissionMode(mode: PermissionMode): Promise<void>
  setModel(model: string): Promise<void>
  setEffort?(effort: string): Promise<void>
  respondPermission(r: PermissionResponse): void
  close(): void
  readonly busy: boolean
}

const req = createRequire(import.meta.url)

/** Map a path inside app.asar to its unpacked twin (native executables can't run from inside asar). */
export function unpacked(p: string): string {
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
}

export function resolvePackageFile(pkg: string, file: string): string | undefined {
  try {
    const p = unpacked(path.join(path.dirname(req.resolve(`${pkg}/package.json`)), file))
    return fs.existsSync(p) ? p : undefined
  } catch {
    return undefined
  }
}

/** The MCP server script (built to out/main/mcp.js next to index.js). */
export function mcpServerSpec(root: string): { command: string; args: string[]; env: Record<string, string> } {
  const script = process.env.NOVEL_MCP_SCRIPT ?? path.join(import.meta.dirname, 'mcp.js')
  return { command: process.execPath, args: [script, '--project', root], env: { ELECTRON_RUN_AS_NODE: '1' } }
}

/** Read-only novel tools that never need a permission prompt. */
export const SAFE_NOVEL_TOOLS = [
  'project_overview',
  'series_overview',
  'universe_overview',
  'bible_categories',
  'bible_appearances',
  'scene_list',
  'scene_read',
  'bible_list',
  'bible_get',
  'bible_search',
  'continuity_context',
  'outline_get',
  'style_guide_get',
  'word_count',
  'snapshot_create',
  'report_write'
]

export function readFileOrUndefined(p: string): string | undefined {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return undefined
  }
}

/** Simple async queue used to feed streaming input into an agent. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiters: ((r: IteratorResult<T>) => void)[] = []
  private closed = false
  push(v: T) {
    const w = this.waiters.shift()
    if (w) w({ value: v, done: false })
    else this.items.push(v)
  }
  close() {
    this.closed = true
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true })
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((r) => this.waiters.push(r))
      }
    }
  }
}
