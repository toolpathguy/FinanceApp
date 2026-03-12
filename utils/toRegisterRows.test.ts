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

    const [row] = toRegisterRows(txs, 'assets:checking')
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

    const [row] = toRegisterRows(txs, 'assets:checking')
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
    expect(rows[0].runningBalance).toBe(-5)
    expect(rows[1].runningBalance).toBe(1995)
    expect(rows[2].runningBalance).toBe(1945)
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

    const [row] = toRegisterRows(txs, 'assets:checking')
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

    const [row] = toRegisterRows(txs, 'assets:checking')
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

    const [row] = toRegisterRows(txs, 'assets:checking')
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

    const [row] = toRegisterRows(txs, 'assets:checking')
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
    expect(rows[0].inflow).toBe(100)
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

    const [row] = toRegisterRows(txs, 'assets:checking')
    expect(row.date).toBe('2025-03-20')
    expect(row.transactionIndex).toBe(42)
    expect(row.status).toBe('!')
  })

  it('returns empty array for empty transactions list', () => {
    expect(toRegisterRows([], 'assets:checking')).toEqual([])
  })
})
