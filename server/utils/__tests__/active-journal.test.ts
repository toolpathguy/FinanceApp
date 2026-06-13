import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Issue #2, R3.4/R3.5: resolveJournalPath precedence = config → env → default.
// readFileSync is mocked so we can simulate the persisted config without
// touching the real config/ directory.

const mockReadFileSync = vi.fn()
vi.mock('node:fs', () => ({
  readFileSync: (...a: any[]) => mockReadFileSync(...a),
}))

const { resolveJournalPath, SAMPLE_JOURNAL, ACTIVE_JOURNAL_CONFIG } = await import('../hledger')

const originalEnv = process.env.LEDGER_FILE

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.LEDGER_FILE
})

afterEach(() => {
  if (originalEnv !== undefined) process.env.LEDGER_FILE = originalEnv
  else delete process.env.LEDGER_FILE
})

function configReturns(content: string | Error) {
  mockReadFileSync.mockImplementation((p: string) => {
    if (p === ACTIVE_JOURNAL_CONFIG) {
      if (content instanceof Error) throw content
      return content
    }
    throw new Error('unexpected read')
  })
}

describe('resolveJournalPath precedence', () => {
  it('config file wins over env and default', () => {
    process.env.LEDGER_FILE = 'env.journal'
    configReturns(JSON.stringify({ path: 'journals/chosen.journal' }))
    expect(resolveJournalPath()).toBe('journals/chosen.journal')
  })

  it('falls back to LEDGER_FILE when config is absent (ENOENT)', () => {
    process.env.LEDGER_FILE = 'env.journal'
    configReturns(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    expect(resolveJournalPath()).toBe('env.journal')
  })

  it('falls back to env when config is corrupt JSON', () => {
    process.env.LEDGER_FILE = 'env.journal'
    configReturns('{ not json')
    expect(resolveJournalPath()).toBe('env.journal')
  })

  it('falls back to env when config has no usable path', () => {
    process.env.LEDGER_FILE = 'env.journal'
    configReturns(JSON.stringify({ path: '   ' }))
    expect(resolveJournalPath()).toBe('env.journal')
  })

  it('falls back to the sample journal when neither config nor env is set', () => {
    configReturns(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    expect(resolveJournalPath()).toBe(SAMPLE_JOURNAL)
  })
})
