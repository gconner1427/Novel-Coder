import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHANGELOG, compareVersions, entriesSince } from '@shared/changelog'

const pkgVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version as string

describe("What's new changelog", () => {
  it('has an entry for the current package version, newest first, with no duplicates', () => {
    expect(CHANGELOG.map((e) => e.version)).toContain(pkgVersion)
    const versions = CHANGELOG.map((e) => e.version)
    expect(new Set(versions).size).toBe(versions.length)
    for (let i = 1; i < versions.length; i++) expect(compareVersions(versions[i - 1], versions[i])).toBeGreaterThan(0)
    for (const e of CHANGELOG) expect(e.items.length).toBeGreaterThan(0)
  })

  it('picks the versions to show after an update', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0)
    // Fresh install: just this version.
    expect(entriesSince('0.1.3').map((e) => e.version)).toEqual(['0.1.3'])
    // Skipped versions are included, newest first; the last-seen version is not.
    expect(entriesSince('0.1.3', '0.1.1').map((e) => e.version)).toEqual(['0.1.3', '0.1.2'])
    // Already seen: nothing.
    expect(entriesSince('0.1.3', '0.1.3')).toEqual([])
  })
})
