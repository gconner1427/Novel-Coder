// Checkpoints for a novel project using a hidden isomorphic-git repo in .novel/history.
// No system Git required. Used for "rewind" after AI edits. For a book inside a series or universe the
// checkpoint covers the whole series or universe folder (shared bibles + every book).
import fs from 'node:fs'
import path from 'node:path'
import git from 'isomorphic-git'
import type { Snapshot } from './types'
import { containerRoot, toPosix } from './project'

const IGNORED_SEGMENTS = new Set(['.novel', 'exports', 'node_modules', '.git'])

/** The folder a book's snapshots cover: its universe, else its series, else the book itself. */
export function snapshotBase(root: string): string {
  return containerRoot(root)
}

function opts(base: string) {
  return { fs, dir: base, gitdir: path.join(base, '.novel', 'history') }
}

function ignored(rel: string): boolean {
  return rel.split('/').some((seg) => IGNORED_SEGMENTS.has(seg))
}

async function ensureRepo(base: string): Promise<void> {
  const o = opts(base)
  if (!fs.existsSync(path.join(o.gitdir, 'HEAD'))) {
    fs.mkdirSync(o.gitdir, { recursive: true })
    await git.init({ ...o, defaultBranch: 'main' })
  }
}

/** Commit the current state of the project. Returns the oid, or null when nothing changed. */
export async function createSnapshot(root: string, message: string): Promise<string | null> {
  const base = snapshotBase(root)
  await ensureRepo(base)
  const o = opts(base)
  const matrix = await git.statusMatrix({ ...o, filter: (f) => !ignored(f) })
  let changed = false
  for (const [file, head, work, stage] of matrix) {
    if (work === 0) {
      if (head !== 0 || stage !== 0) {
        await git.remove({ ...o, filepath: file })
        changed = true
      }
    } else if (head !== work || work !== stage) {
      await git.add({ ...o, filepath: file })
      changed = true
    }
  }
  let hasHead = true
  try {
    await git.resolveRef({ ...o, ref: 'HEAD' })
  } catch {
    hasHead = false
  }
  if (!changed && hasHead) return null
  return git.commit({ ...o, message, author: { name: 'Novel Coder', email: 'snapshots@novelcoder.local' } })
}

export async function listSnapshots(root: string, depth = 100): Promise<Snapshot[]> {
  try {
    const log = await git.log({ ...opts(snapshotBase(root)), depth })
    return log.map((c) => ({ oid: c.oid, message: c.commit.message.trim(), timestamp: c.commit.author.timestamp * 1000 }))
  } catch {
    return []
  }
}

/** Restore the working files to a snapshot (a safety snapshot of the current state is taken first). */
export async function restoreSnapshot(root: string, oid: string): Promise<void> {
  const base = snapshotBase(root)
  const o = opts(base)
  await createSnapshot(root, 'Before rewind')
  const target = new Set(await git.listFiles({ ...o, ref: oid }))
  const current = await git.listFiles({ ...o, ref: 'HEAD' })
  for (const f of current) {
    if (!target.has(f) && !ignored(f)) fs.rmSync(path.join(base, f), { force: true })
  }
  for (const f of target) {
    const { blob } = await git.readBlob({ ...o, oid, filepath: f })
    const abs = path.join(base, f)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, Buffer.from(blob))
  }
  await createSnapshot(root, `Rewound to ${oid.slice(0, 7)}`)
}

/** Text of one file (path relative to the book root) at a snapshot, for diffs. */
export async function fileAtSnapshot(root: string, oid: string, rel: string): Promise<string | null> {
  const base = snapshotBase(root)
  const filepath = toPosix(path.relative(base, path.resolve(root, rel)))
  try {
    const { blob } = await git.readBlob({ ...opts(base), oid, filepath })
    return Buffer.from(blob).toString('utf8')
  } catch {
    return null
  }
}
