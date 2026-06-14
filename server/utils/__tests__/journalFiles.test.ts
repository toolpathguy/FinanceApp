import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import { basename, join, sep } from 'node:path'

// createError is a Nitro auto-import at runtime; stub it for unit tests.
vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage: string }) => {
  const err = new Error(opts.statusMessage) as any
  err.statusCode = opts.statusCode
  return err
})

const { safeJournalPath, JOURNALS_DIR } = await import('../journalFiles')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('safeJournalPath()', () => {
  it('accepts a plain journal filename and resolves inside JOURNALS_DIR', () => {
    const p = safeJournalPath('budget.journal')
    expect(p).toBe(join(JOURNALS_DIR, 'budget.journal'))
    expect(p.startsWith(JOURNALS_DIR + sep)).toBe(true)
  })

  it('accepts .hledger and .j extensions', () => {
    expect(safeJournalPath('a.hledger')).toBe(join(JOURNALS_DIR, 'a.hledger'))
    expect(safeJournalPath('a.j')).toBe(join(JOURNALS_DIR, 'a.j'))
  })

  it('trims surrounding whitespace', () => {
    expect(safeJournalPath('  x.journal  ')).toBe(join(JOURNALS_DIR, 'x.journal'))
  })

  it('rejects an empty / whitespace filename', () => {
    expect(() => safeJournalPath('')).toThrow()
    expect(() => safeJournalPath('   ')).toThrow()
  })

  it('rejects a missing/disallowed extension', () => {
    expect(() => safeJournalPath('notes.txt')).toThrow(/end with/i)
    expect(() => safeJournalPath('budget')).toThrow(/end with/i)
  })

  it('rejects parent-directory traversal', () => {
    expect(() => safeJournalPath('../secret.journal')).toThrow(/path/i)
    expect(() => safeJournalPath('../../etc/passwd.journal')).toThrow(/path/i)
  })

  it('rejects forward-slash subpaths', () => {
    expect(() => safeJournalPath('sub/budget.journal')).toThrow(/path/i)
  })

  it('rejects backslash subpaths', () => {
    expect(() => safeJournalPath('sub\\budget.journal')).toThrow(/path/i)
  })

  it('rejects absolute and drive paths', () => {
    expect(() => safeJournalPath('/etc/passwd.journal')).toThrow()
    expect(() => safeJournalPath('C:\\Windows\\sys.journal')).toThrow()
  })
})

describe('safeJournalPath() — property (R2, NFR5)', () => {
  it('any name containing a separator or .. is rejected', () => {
    const evil = fc
      .tuple(
        fc.constantFrom('a', 'sub', '..', '...'),
        fc.constantFrom('/', '\\'),
        fc.constantFrom('x.journal', 'y.hledger', 'passwd')
      )
      .map(([a, s, b]) => `${a}${s}${b}`)
    fc.assert(
      fc.property(evil, (name) => {
        // sanity: these names genuinely contain a separator/traversal
        expect(basename(name) !== name).toBe(true)
        expect(() => safeJournalPath(name)).toThrow()
      }),
      { numRuns: 100 }
    )
  })

  it('any accepted name resolves strictly inside JOURNALS_DIR', () => {
    const ok = fc
      .stringMatching(/^[A-Za-z0-9_-]{1,20}$/)
      .map((stem) => `${stem}.journal`)
    fc.assert(
      fc.property(ok, (name) => {
        const p = safeJournalPath(name)
        expect(p.startsWith(JOURNALS_DIR + sep)).toBe(true)
      }),
      { numRuns: 100 }
    )
  })
})
