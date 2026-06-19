import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TransactionInput } from '../../../types/api'

// Capture what gets handed to the journal writer so we can assert the postings
// the simplified→balanced conversion produced (Issue #9 extraction).
const h = vi.hoisted(() => ({ append: vi.fn() }))
vi.mock('../journalWriter', () => ({ appendTransaction: (...a: any[]) => h.append(...a) }))

// `resolveBudgetBase` is a Nitro auto-imported global in app runtime.
vi.stubGlobal('resolveBudgetBase', async () => 'assets:checking')

const { appendSimplifiedTransaction } = await import('../transactionWriter')

const lastTx = (): TransactionInput => h.append.mock.calls.at(-1)![0]

beforeEach(() => {
  vi.clearAllMocks()
  h.append.mockResolvedValue(undefined)
})

describe('appendSimplifiedTransaction — envelope-aware postings', () => {
  it('expense from an asset account → 2 postings (expense debit, budget sub-account credit)', async () => {
    await appendSimplifiedTransaction({
      date: '2026-06-17', payee: 'Store', account: 'assets:checking',
      type: 'expense', category: 'expenses:food:groceries', amount: 40,
    })
    const tx = lastTx()
    expect(tx.postings).toEqual([
      { account: 'expenses:food:groceries', amount: 40, commodity: '$' },
      { account: 'assets:checking:budget:food:groceries', amount: -40, commodity: '$' },
    ])
  })

  it('expense from a liability account → 4 postings (with pending budget leg)', async () => {
    await appendSimplifiedTransaction({
      date: '2026-06-17', payee: 'Store', account: 'liabilities:visa',
      type: 'expense', category: 'expenses:food:dining', amount: 25,
    })
    const tx = lastTx()
    expect(tx.postings).toEqual([
      { account: 'expenses:food:dining', amount: 25, commodity: '$' },
      { account: 'assets:checking:budget:food:dining', amount: -25, commodity: '$' },
      { account: 'assets:checking:budget:pending:visa', amount: 25, commodity: '$' },
      { account: 'liabilities:visa', amount: -25, commodity: '$' },
    ])
  })

  it('income → asset debit + income credit (no envelope postings)', async () => {
    await appendSimplifiedTransaction({
      date: '2026-06-17', payee: 'Employer', account: 'assets:checking',
      type: 'income', category: 'income:salary', amount: 1000,
    })
    const tx = lastTx()
    expect(tx.postings).toEqual([
      { account: 'assets:checking', amount: 1000, commodity: '$' },
      { account: 'income:salary', amount: -1000, commodity: '$' },
    ])
  })

  it('propagates a validation failure from the journal writer (no swallowing)', async () => {
    h.append.mockRejectedValueOnce(new Error('Postings do not sum to zero'))
    await expect(appendSimplifiedTransaction({
      date: 'bad', payee: 'x', account: 'assets:checking',
      type: 'income', category: 'income:salary', amount: 5,
    })).rejects.toThrow(/sum to zero/)
  })
})
