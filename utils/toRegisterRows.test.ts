import { describe, it, expect } from 'vitest'
import { toRegisterRows } from './toRegisterRows'
import type { HledgerTransaction } from '~/types/hledger'

function makeTx(overrides: Partial<HledgerTransaction> & Pick<HledgerTransaction, 'postings'>): HledgerTransaction {
  return {
    date: '2025-01-15',
    description: 'Test payee',
    status: '*',
    index: 1,
    ...overrides,
  }
}

describe('toRegisterRows', () => {
  it('returns one row per transaction that matches the account', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        index: 1,
        postings: [
          { account: 'expenses:dining', amounts: [{ commodity: '$', quantity: 5 }] },
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: -5 }] },
        ],
      }),
      makeTx({
        index: 2,
        postings: [
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: 2000 }] },
          { account: 'income:salary', amounts: [{ commodity: '$', quantity: -2000 }] },
        ],
      }),
    ]

    const rows = toRegisterRows(txs, 'assets:checking')
    expect(rows).toHaveLength(2)
  })

  it('sets outflow for negative amounts and inflow for positive amounts', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        description: 'Coffee Shop',
        postings: [
          { account: 'expenses:dining', amounts: [{ commodity: '$', quantity: 5 }] },
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: -5 }] },
        ],
      }),
    ]

    const row = toRegisterRows(txs, 'assets:checking')[0]!
    expect(row.inflow).toBeNull()
    expect(row.outflow).toBe(5)
  })

  it('sets inflow for positive amounts', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        description: 'Employer',
        postings: [
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: 2000 }] },
          { account: 'income:salary', amounts: [{ commodity: '$', quantity: -2000 }] },
        ],
      }),
    ]

    const row = toRegisterRows(txs, 'assets:checking')[0]!
    expect(row.inflow).toBe(2000)
    expect(row.outflow).toBeNull()
  })

  it('computes running balance as cumulative sum', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        index: 1,
        postings: [
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: -5 }] },
          { account: 'expenses:dining', amounts: [{ commodity: '$', quantity: 5 }] },
        ],
      }),
      makeTx({
        index: 2,
        postings: [
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: 2000 }] },
          { account: 'income:salary', amounts: [{ commodity: '$', quantity: -2000 }] },
        ],
      }),
      makeTx({
        index: 3,
        postings: [
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: -50 }] },
          { account: 'expenses:groceries', amounts: [{ commodity: '$', quantity: 50 }] },
        ],
      }),
    ]

    const rows = toRegisterRows(txs, 'assets:checking')
    expect(rows[0]!.runningBalance).toBe(-5)
    expect(rows[1]!.runningBalance).toBe(1995)
    expect(rows[2]!.runningBalance).toBe(1945)
  })

  // Issue #4 item 4: a date-filtered register seeds the running balance with the
  // window's opening balance instead of resetting to $0.
  it('seeds the running balance from openingBalance', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        index: 1,
        postings: [
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: -5 }] },
          { account: 'expenses:dining', amounts: [{ commodity: '$', quantity: 5 }] },
        ],
      }),
      makeTx({
        index: 2,
        postings: [
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: 2000 }] },
          { account: 'income:salary', amounts: [{ commodity: '$', quantity: -2000 }] },
        ],
      }),
    ]

    const rows = toRegisterRows(txs, 'assets:checking', 1000)
    // Every row is offset by the $1000 opening balance vs. the unseeded case.
    expect(rows[0]!.runningBalance).toBe(995)
    expect(rows[1]!.runningBalance).toBe(2995)
  })

  it('defaults openingBalance to 0 (unchanged behavior)', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        postings: [
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: -5 }] },
          { account: 'expenses:dining', amounts: [{ commodity: '$', quantity: 5 }] },
        ],
      }),
    ]
    expect(toRegisterRows(txs, 'assets:checking')[0]!.runningBalance).toBe(-5)
  })

  it('detects transfers when other posting is assets/liabilities', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        description: 'Move to savings',
        postings: [
          { account: 'assets:savings', amounts: [{ commodity: '$', quantity: 500 }] },
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: -500 }] },
        ],
      }),
    ]

    const row = toRegisterRows(txs, 'assets:checking')[0]!
    expect(row.isTransfer).toBe(true)
    expect(row.category).toBe('')
    expect(row.payee).toBe('Transfer: Savings')
  })

  it('detects transfers to liabilities', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        description: 'Pay credit card',
        postings: [
          { account: 'liabilities:credit-card', amounts: [{ commodity: '$', quantity: 200 }] },
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: -200 }] },
        ],
      }),
    ]

    const row = toRegisterRows(txs, 'assets:checking')[0]!
    expect(row.isTransfer).toBe(true)
    expect(row.payee).toBe('Transfer: Credit-card')
  })

  it('derives category from other posting for non-transfers', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        description: 'Coffee Shop',
        postings: [
          { account: 'expenses:dining', amounts: [{ commodity: '$', quantity: 5 }] },
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: -5 }] },
        ],
      }),
    ]

    const row = toRegisterRows(txs, 'assets:checking')[0]!
    expect(row.isTransfer).toBe(false)
    expect(row.category).toBe('Dining')
    expect(row.categoryRaw).toBe('expenses:dining')
    expect(row.payee).toBe('Coffee Shop')
  })

  it('handles legacy transactions with >2 postings as "Split"', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        description: 'Complex purchase',
        postings: [
          { account: 'expenses:food', amounts: [{ commodity: '$', quantity: 30 }] },
          { account: 'expenses:household', amounts: [{ commodity: '$', quantity: 20 }] },
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: -50 }] },
        ],
      }),
    ]

    const row = toRegisterRows(txs, 'assets:checking')[0]!
    expect(row.category).toBe('Split')
    expect(row.categoryRaw).toBe('')
    expect(row.isTransfer).toBe(false)
    expect(row.outflow).toBe(50)
    expect(row.payee).toBe('Complex purchase')
  })

  it('skips transactions that do not match the account', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        postings: [
          { account: 'expenses:dining', amounts: [{ commodity: '$', quantity: 5 }] },
          { account: 'assets:savings', amounts: [{ commodity: '$', quantity: -5 }] },
        ],
      }),
    ]

    const rows = toRegisterRows(txs, 'assets:checking')
    expect(rows).toHaveLength(0)
  })

  it('matches sub-accounts of the given account path', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        description: 'Sub-account tx',
        postings: [
          { account: 'assets:checking:business', amounts: [{ commodity: '$', quantity: 100 }] },
          { account: 'income:freelance', amounts: [{ commodity: '$', quantity: -100 }] },
        ],
      }),
    ]

    const rows = toRegisterRows(txs, 'assets:checking')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.inflow).toBe(100)
  })

  it('preserves transaction metadata (date, index, status)', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        date: '2025-03-20',
        index: 42,
        status: '!',
        postings: [
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: 100 }] },
          { account: 'income:salary', amounts: [{ commodity: '$', quantity: -100 }] },
        ],
      }),
    ]

    const row = toRegisterRows(txs, 'assets:checking')[0]!
    expect(row.date).toBe('2025-03-20')
    expect(row.transactionIndex).toBe(42)
    expect(row.status).toBe('!')
  })

  it('returns empty array for empty transactions list', () => {
    expect(toRegisterRows([], 'assets:checking')).toEqual([])
  })

  // ─── Family aggregation (envelope model, Issue #3 / R1) ───────────────────

  it('aggregates an envelope-funded expense as a single outflow on the real account', () => {
    // Rent: bare checking never moves; the budget envelope does.
    const txs: HledgerTransaction[] = [
      makeTx({
        description: 'Rent',
        postings: [
          { account: 'expenses:housing:rent', amounts: [{ commodity: '$', quantity: 1200 }] },
          { account: 'assets:checking:budget:housing:rent', amounts: [{ commodity: '$', quantity: -1200 }] },
        ],
      }),
    ]

    const rows = toRegisterRows(txs, 'assets:checking')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.outflow).toBe(1200)
    expect(rows[0]!.inflow).toBeNull()
    expect(rows[0]!.runningBalance).toBe(-1200)
    expect(rows[0]!.categoryRaw).toBe('expenses:housing:rent')
    expect(rows[0]!.isTransfer).toBe(false)
  })

  it('omits a budget assignment (checking → envelope nets to zero) from the real-account register', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        description: 'Budget Assignment',
        postings: [
          { account: 'assets:checking:budget:food', amounts: [{ commodity: '$', quantity: 400 }] },
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: -400 }] },
        ],
      }),
    ]
    expect(toRegisterRows(txs, 'assets:checking')).toHaveLength(0)
  })

  it('omits an envelope-to-envelope transfer from the real-account register', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        description: 'Budget Transfer',
        postings: [
          { account: 'assets:checking:budget:food', amounts: [{ commodity: '$', quantity: 50 }] },
          { account: 'assets:checking:budget:transport', amounts: [{ commodity: '$', quantity: -50 }] },
        ],
      }),
    ]
    expect(toRegisterRows(txs, 'assets:checking')).toHaveLength(0)
  })

  it('omits a credit-card expense (moves money between envelopes only) from the real-account register', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        description: 'Restaurant',
        postings: [
          { account: 'expenses:food:restaurants', amounts: [{ commodity: '$', quantity: 45 }] },
          { account: 'assets:checking:budget:food:restaurants', amounts: [{ commodity: '$', quantity: -45 }] },
          { account: 'assets:checking:budget:pending:credit-card', amounts: [{ commodity: '$', quantity: 45 }] },
          { account: 'liabilities:credit-card', amounts: [{ commodity: '$', quantity: -45 }] },
        ],
      }),
    ]
    // Net to the checking family = -45 + 45 = 0 → no real balance change.
    expect(toRegisterRows(txs, 'assets:checking')).toHaveLength(0)
  })

  it('register running balance tracks the real bank balance across mixed activity', () => {
    const txs: HledgerTransaction[] = [
      makeTx({ index: 1, description: 'Salary', postings: [
        { account: 'assets:checking', amounts: [{ commodity: '$', quantity: 2000 }] },
        { account: 'income:salary', amounts: [{ commodity: '$', quantity: -2000 }] },
      ] }),
      makeTx({ index: 2, description: 'Budget Assignment', postings: [
        { account: 'assets:checking:budget:food', amounts: [{ commodity: '$', quantity: 500 }] },
        { account: 'assets:checking', amounts: [{ commodity: '$', quantity: -500 }] },
      ] }),
      makeTx({ index: 3, description: 'Rent', postings: [
        { account: 'expenses:housing:rent', amounts: [{ commodity: '$', quantity: 1200 }] },
        { account: 'assets:checking:budget:housing:rent', amounts: [{ commodity: '$', quantity: -1200 }] },
      ] }),
    ]

    const rows = toRegisterRows(txs, 'assets:checking')
    // Assignment (tx 2) is internal → dropped. Salary +2000, Rent -1200.
    expect(rows).toHaveLength(2)
    expect(rows[0]!.runningBalance).toBe(2000)
    expect(rows[1]!.runningBalance).toBe(800)
  })

  it('shows envelope-level activity when viewing a budget sub-account directly (R1.5)', () => {
    const txs: HledgerTransaction[] = [
      makeTx({ index: 1, description: 'Budget Assignment', postings: [
        { account: 'assets:checking:budget:food', amounts: [{ commodity: '$', quantity: 400 }] },
        { account: 'assets:checking', amounts: [{ commodity: '$', quantity: -400 }] },
      ] }),
      makeTx({ index: 2, description: 'Grocery Store', postings: [
        { account: 'expenses:food', amounts: [{ commodity: '$', quantity: 60 }] },
        { account: 'assets:checking:budget:food', amounts: [{ commodity: '$', quantity: -60 }] },
      ] }),
    ]

    const rows = toRegisterRows(txs, 'assets:checking:budget:food')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.inflow).toBe(400)   // funded from checking
    expect(rows[1]!.outflow).toBe(60)   // spent on groceries
    expect(rows[1]!.runningBalance).toBe(340)
  })

  it('flags a multi-commodity family posting instead of silently dropping a commodity (R6.3)', () => {
    const txs: HledgerTransaction[] = [
      makeTx({
        description: 'FX deposit',
        postings: [
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: 100 }, { commodity: '€', quantity: 50 }] },
          { account: 'income:misc', amounts: [{ commodity: '$', quantity: -100 }] },
        ],
      }),
    ]

    const row = toRegisterRows(txs, 'assets:checking')[0]!
    expect(row.category).toBe('Multiple currencies')
    expect(row.inflow).toBeNull()
    expect(row.outflow).toBeNull()
  })
})
