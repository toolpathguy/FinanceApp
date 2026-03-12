import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { toRegisterRows } from './toRegisterRows'
import type { HledgerTransaction } from '~/types/hledger'

// ─── Generators ─────────────────────────────────────────────────────────────

/** Account name segment: lowercase letters, 2-12 chars */
const arbSegment = fc.stringMatching(/^[a-z][a-z0-9-]{1,10}$/)

/** Generates a real account path (assets: or liabilities:) */
const arbRealAccount = fc.oneof(
  arbSegment.map(s => `assets:${s}`),
  arbSegment.map(s => `liabilities:${s}`),
)

/** Generates a category account path (expenses: or income:) */
const arbCategoryAccount = fc.oneof(
  arbSegment.map(s => `expenses:${s}`),
  arbSegment.map(s => `income:${s}`),
)

/** Generates a positive amount rounded to 2 decimal places */
const arbAmount = fc
  .double({ min: 0.01, max: 99999, noNaN: true, noDefaultInfinity: true })
  .map(n => Math.round(n * 100) / 100)
  .filter(n => n > 0)

/** Generates a valid YYYY-MM-DD date string */
const arbDate = fc
  .tuple(
    fc.integer({ min: 2000, max: 2099 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)

const arbStatus = fc.constantFrom('' as const, '!' as const, '*' as const)

/**
 * Generates a valid HledgerTransaction with exactly 2 balanced postings
 * for a given account path. The "other" posting is either a real account
 * (transfer) or a category account (expense/income).
 */
function arbHledgerTransaction(accountPath: string): fc.Arbitrary<HledgerTransaction> {
  const arbOtherAccount = fc.oneof(arbRealAccount, arbCategoryAccount)
    .filter(a => a !== accountPath)

  return fc
    .tuple(arbDate, fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,19}$/), arbStatus, arbAmount, arbOtherAccount, fc.nat({ max: 9999 }))
    .map(([date, description, status, amount, otherAccount, index]) => {
      // Randomly decide if this account receives (positive) or sends (negative)
      // We use the index parity to deterministically pick a sign
      const sign = index % 2 === 0 ? 1 : -1
      const thisAmount = sign * amount
      const otherAmount = -thisAmount

      return {
        date,
        description,
        status,
        index,
        postings: [
          { account: accountPath, amounts: [{ commodity: '$', quantity: thisAmount }] },
          { account: otherAccount, amounts: [{ commodity: '$', quantity: otherAmount }] },
        ],
      }
    })
}

/** Generates an array of balanced 2-posting transactions for a given account */
function arbTransactionList(accountPath: string): fc.Arbitrary<HledgerTransaction[]> {
  return fc.array(arbHledgerTransaction(accountPath), { minLength: 1, maxLength: 20 })
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('toRegisterRows — Property Tests', () => {
  const testAccount = 'assets:checking'

  /**
   * Property 4: Register row inflow/outflow mutual exclusivity
   *
   * For any list of HledgerTransactions and account path, every RegisterRow
   * produced by toRegisterRows should have exactly one of inflow or outflow
   * set (the other null), and the set value should always be positive.
   *
   * **Validates: Requirements 5.2, 5.3**
   */
  it('Property 4: every row has exactly one of inflow/outflow set, and the value is positive', () => {
    fc.assert(
      fc.property(arbTransactionList(testAccount), (txs) => {
        const rows = toRegisterRows(txs, testAccount)

        for (const row of rows) {
          const hasInflow = row.inflow !== null
          const hasOutflow = row.outflow !== null

          // Exactly one must be set
          expect(hasInflow !== hasOutflow).toBe(true)

          // The set value must be positive
          if (hasInflow) {
            expect(row.inflow).toBeGreaterThan(0)
          }
          if (hasOutflow) {
            expect(row.outflow).toBeGreaterThan(0)
          }
        }
      }),
    )
  })

  /**
   * Property 5: Register running balance is cumulative sum
   *
   * For any list of HledgerTransactions and account path, the runningBalance
   * of each RegisterRow should equal the cumulative sum of (inflow ?? 0) - (outflow ?? 0)
   * for all rows from the first to the current row.
   *
   * **Validates: Requirement 5.4**
   */
  it('Property 5: runningBalance equals cumulative sum of (inflow - outflow)', () => {
    fc.assert(
      fc.property(arbTransactionList(testAccount), (txs) => {
        const rows = toRegisterRows(txs, testAccount)

        let cumulativeBalance = 0
        for (const row of rows) {
          cumulativeBalance += (row.inflow ?? 0) - (row.outflow ?? 0)
          expect(row.runningBalance).toBeCloseTo(cumulativeBalance, 8)
        }
      }),
    )
  })

  /**
   * Property 6: Transfer detection and category derivation
   *
   * For any list of HledgerTransactions and account path, every RegisterRow
   * where the other posting belongs to a real account (assets:/liabilities:)
   * should have isTransfer true, category empty, and payee starting with
   * "Transfer: ". Rows where the other posting belongs to a category account
   * should have isTransfer false and category non-empty.
   *
   * **Validates: Requirements 5.5, 5.6**
   */
  it('Property 6: transfers have isTransfer=true, empty category, "Transfer: " payee prefix; non-transfers have category set', () => {
    fc.assert(
      fc.property(arbTransactionList(testAccount), (txs) => {
        const rows = toRegisterRows(txs, testAccount)

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          const otherAccount = row.categoryRaw

          const isRealAccount = otherAccount.startsWith('assets:') || otherAccount.startsWith('liabilities:')
          const isCategoryAccount = otherAccount.startsWith('expenses:') || otherAccount.startsWith('income:')

          if (isRealAccount) {
            expect(row.isTransfer).toBe(true)
            expect(row.category).toBe('')
            expect(row.payee.startsWith('Transfer: ')).toBe(true)
          }

          if (isCategoryAccount) {
            expect(row.isTransfer).toBe(false)
            expect(row.category.length).toBeGreaterThan(0)
          }
        }
      }),
    )
  })
})
