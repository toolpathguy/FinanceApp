import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { pathExists } from '../fsExists'

const here = dirname(fileURLToPath(import.meta.url))

describe('pathExists (Issue #4 item 5b)', () => {
  it('returns true for an existing file', async () => {
    // This very test file exists.
    expect(await pathExists(fileURLToPath(import.meta.url))).toBe(true)
  })

  it('returns true for an existing directory', async () => {
    expect(await pathExists(here)).toBe(true)
  })

  it('returns false for a missing path (never throws)', async () => {
    expect(await pathExists(join(here, 'definitely-not-here-xyzzy.json'))).toBe(false)
  })
})
