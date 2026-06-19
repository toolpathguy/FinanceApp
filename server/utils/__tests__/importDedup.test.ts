import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ txList: vi.fn() }))
vi.mock('../transactionList', () => ({ getTransactionList: (...a: any[]) => h.txList(...a) }))

const { computeDedupHash, loadJournalHashes } = await import('../importDedup')

beforeEach(() => vi.clearAllMocks())

describe('computeDedupHash', () => {
  it('is stable across equivalent amounts and payee casing/whitespace', () => {
    const a = computeDedupHash({ date: '2026-06-17', amount: 5, payee: 'Coffee Shop' })
    const b = computeDedupHash({ date: '2026-06-17', amount: 5.0, payee: '  coffee shop ' })
    expect(a).toBe(b)
  })

  it('differs on date, amount, or payee', () => {
    const base = computeDedupHash({ date: '2026-06-17', amount: 5, payee: 'X' })
    expect(computeDedupHash({ date: '2026-06-18', amount: 5, payee: 'X' })).not.toBe(base)
    expect(computeDedupHash({ date: '2026-06-17', amount: 6, payee: 'X' })).not.toBe(base)
    expect(computeDedupHash({ date: '2026-06-17', amount: 5, payee: 'Y' })).not.toBe(base)
  })

  it('treats $5.00 and 5 as the same (cents rounding)', () => {
    expect(computeDedupHash({ date: '2026-06-17', amount: 5.004, payee: 'X' }))
      .toBe(computeDedupHash({ date: '2026-06-17', amount: 5, payee: 'X' }))
  })
})

describe('loadJournalHashes', () => {
  it('builds a hash set from existing journal entries (sign-insensitive)', async () => {
    h.txList.mockResolvedValue([
      { date: '2026-06-01', payee: 'Rent', amount: -1200, account: 'expenses:rent' },
      { date: '2026-06-02', payee: 'Salary', amount: 3000, account: 'income:salary' },
    ])
    const hashes = await loadJournalHashes()
    // An outflow proposal (positive magnitude) matches the negative journal leg.
    expect(hashes.has(computeDedupHash({ date: '2026-06-01', amount: 1200, payee: 'Rent' }))).toBe(true)
    expect(hashes.has(computeDedupHash({ date: '2026-06-02', amount: 3000, payee: 'Salary' }))).toBe(true)
    expect(hashes.has(computeDedupHash({ date: '2026-06-03', amount: 1, payee: 'Nope' }))).toBe(false)
  })
})
