import { describe, it, expect } from 'vitest'
import { normalizeDate, normalizeProposals } from '../importParse'

const CONTEXT = {
  accounts: ['assets:checking', 'liabilities:visa'],
  envelopes: ['food:groceries', 'rent'],
}
const NO_HASHES = new Set<string>()

function wrap(transactions: unknown[]) {
  return { transactions }
}

describe('normalizeDate', () => {
  it('passes through ISO dates', () => {
    expect(normalizeDate('2026-06-17')).toBe('2026-06-17')
    expect(normalizeDate('2026-6-7')).toBe('2026-06-07')
  })
  it('converts MM/DD/YYYY (US default) and DD/MM when day > 12', () => {
    expect(normalizeDate('06/17/2026')).toBe('2026-06-17') // MM/DD
    expect(normalizeDate('17/06/2026')).toBe('2026-06-17') // first part > 12 → DD/MM
  })
  it('converts "D Mon YYYY"', () => {
    expect(normalizeDate('5 Jun 2026')).toBe('2026-06-05')
    expect(normalizeDate('17 December 2026')).toBe('2026-12-17')
  })
  it('rejects nonsense and impossible dates', () => {
    expect(normalizeDate('not a date')).toBeNull()
    expect(normalizeDate('2026-13-01')).toBeNull()
    expect(normalizeDate('2026-02-30')).toBeNull()
  })
})

describe('normalizeProposals', () => {
  it('maps a signed single-column outflow to magnitude + direction', () => {
    const { proposals, droppedRows } = normalizeProposals(
      wrap([{ date: '2026-06-17', payee: 'Store', amount: 42.5, direction: 'outflow',
        suggestedAccount: 'assets:checking', suggestedEnvelope: 'food:groceries', sourceRow: 'raw1' }]),
      CONTEXT, NO_HASHES,
    )
    expect(droppedRows).toHaveLength(0)
    expect(proposals[0]).toMatchObject({
      date: '2026-06-17', amount: 42.5, direction: 'outflow',
      suggestedAccount: 'assets:checking', suggestedEnvelope: 'food:groceries', sourceRow: 'raw1',
    })
  })

  it('takes the magnitude of a negative amount (separate debit column case)', () => {
    const { proposals } = normalizeProposals(
      wrap([{ date: '2026-06-17', payee: 'X', amount: -19.99, direction: 'outflow',
        suggestedAccount: '', suggestedEnvelope: '', sourceRow: 'r' }]),
      CONTEXT, NO_HASHES,
    )
    expect(proposals[0]!.amount).toBe(19.99)
    expect(proposals[0]!.direction).toBe('outflow')
  })

  it('blanks suggestions that are not real targets, strips an expenses: prefix', () => {
    const { proposals } = normalizeProposals(
      wrap([{ date: '2026-06-17', payee: 'X', amount: 5, direction: 'outflow',
        suggestedAccount: 'assets:nope', suggestedEnvelope: 'expenses:rent', sourceRow: 'r' }]),
      CONTEXT, NO_HASHES,
    )
    expect(proposals[0]!.suggestedAccount).toBe('') // not in context
    expect(proposals[0]!.suggestedEnvelope).toBe('rent') // prefix stripped, matches context
  })

  it('surfaces unparseable rows in droppedRows (never silently dropped, R1.4)', () => {
    const { proposals, droppedRows } = normalizeProposals(
      wrap([
        { date: 'garbage', payee: 'X', amount: 5, direction: 'outflow', suggestedAccount: '', suggestedEnvelope: '', sourceRow: 'bad-date' },
        { date: '2026-06-17', payee: 'X', amount: 0, direction: 'outflow', suggestedAccount: '', suggestedEnvelope: '', sourceRow: 'zero-amt' },
        { date: '2026-06-17', payee: 'X', amount: 5, direction: 'sideways', suggestedAccount: '', suggestedEnvelope: '', sourceRow: 'bad-dir' },
        { date: '2026-06-17', payee: 'OK', amount: 5, direction: 'inflow', suggestedAccount: '', suggestedEnvelope: '', sourceRow: 'good' },
      ]),
      CONTEXT, NO_HASHES,
    )
    expect(proposals).toHaveLength(1)
    expect(proposals[0]!.sourceRow).toBe('good')
    expect(droppedRows.map(d => d.sourceRow)).toEqual(['bad-date', 'zero-amt', 'bad-dir'])
  })

  it('flags possibleDuplicate when the hash exists in the journal', () => {
    const first = normalizeProposals(
      wrap([{ date: '2026-06-17', payee: 'Coffee', amount: 5, direction: 'outflow', suggestedAccount: '', suggestedEnvelope: '', sourceRow: 'r' }]),
      CONTEXT, NO_HASHES,
    ).proposals[0]!
    const { proposals } = normalizeProposals(
      wrap([{ date: '2026-06-17', payee: 'Coffee', amount: 5, direction: 'outflow', suggestedAccount: '', suggestedEnvelope: '', sourceRow: 'r' }]),
      CONTEXT, new Set([first.dedupHash]),
    )
    expect(proposals[0]!.possibleDuplicate).toBe(true)
  })
})
