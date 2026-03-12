import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { filterRealAccounts, filterCategoryAccounts } from './filterAccounts'

/**
 * Arbitrary: generates a single account segment (non-empty, no colons).
 */
const accountSegment = fc.stringMatching(/^[a-z]{1,8}$/)

/**
 * Arbitrary: generates a sub-path of 1–3 colon-separated segments.
 */
const subPath = fc.array(accountSegment, { minLength: 1, maxLength: 3 }).map(parts => parts.join(':'))

/**
 * Known hledger top-level prefixes.
 */
const realPrefix = fc.constantFrom('assets', 'liabilities')
const categoryPrefix = fc.constantFrom('expenses', 'income')
const otherPrefix = fc.constantFrom('equity', 'other', 'misc')

/**
 * Arbitrary: generates a full account path with a known prefix.
 */
const realAccount = fc.tuple(realPrefix, subPath).map(([p, s]) => `${p}:${s}`)
const categoryAccount = fc.tuple(categoryPrefix, subPath).map(([p, s]) => `${p}:${s}`)
const otherAccount = fc.tuple(otherPrefix, subPath).map(([p, s]) => `${p}:${s}`)

/**
 * Arbitrary: generates a mixed array of account paths with various prefixes.
 */
const arbAccountList = fc.array(
  fc.oneof(realAccount, categoryAccount, otherAccount),
  { minLength: 0, maxLength: 30 },
)

/**
 * Helper: checks that `result` is a subsequence of `source` (preserves order).
 */
function isSubsequence(result: string[], source: string[]): boolean {
  let j = 0
  for (let i = 0; i < source.length && j < result.length; i++) {
    if (source[i] === result[j]) j++
  }
  return j === result.length
}

describe('filterAccounts — Property Tests', () => {
  /**
   * Property 7: Account filter correctness and disjointness
   *
   * For any array of hledger account path strings, filterRealAccounts should return only
   * accounts starting with "assets:" or "liabilities:", filterCategoryAccounts should return
   * only accounts starting with "expenses:" or "income:", the two result sets should be
   * disjoint, and both should preserve the original order.
   *
   * **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
   */

  it('filterRealAccounts returns only accounts starting with "assets:" or "liabilities:"', () => {
    fc.assert(
      fc.property(arbAccountList, (accounts) => {
        const result = filterRealAccounts(accounts)
        for (const a of result) {
          expect(a.startsWith('assets:') || a.startsWith('liabilities:')).toBe(true)
        }
      }),
    )
  })

  it('filterCategoryAccounts returns only accounts starting with "expenses:" or "income:"', () => {
    fc.assert(
      fc.property(arbAccountList, (accounts) => {
        const result = filterCategoryAccounts(accounts)
        for (const a of result) {
          expect(a.startsWith('expenses:') || a.startsWith('income:')).toBe(true)
        }
      }),
    )
  })

  it('the two result sets are disjoint (no overlap)', () => {
    fc.assert(
      fc.property(arbAccountList, (accounts) => {
        const real = filterRealAccounts(accounts)
        const category = filterCategoryAccounts(accounts)
        const realSet = new Set(real)
        for (const a of category) {
          expect(realSet.has(a)).toBe(false)
        }
      }),
    )
  })

  it('both preserve original order (result is a subsequence of input)', () => {
    fc.assert(
      fc.property(arbAccountList, (accounts) => {
        const real = filterRealAccounts(accounts)
        const category = filterCategoryAccounts(accounts)
        expect(isSubsequence(real, accounts)).toBe(true)
        expect(isSubsequence(category, accounts)).toBe(true)
      }),
    )
  })

  it('result is always a subset of input (no new accounts created)', () => {
    fc.assert(
      fc.property(arbAccountList, (accounts) => {
        const inputSet = new Set(accounts)
        const real = filterRealAccounts(accounts)
        const category = filterCategoryAccounts(accounts)
        for (const a of real) {
          expect(inputSet.has(a)).toBe(true)
        }
        for (const a of category) {
          expect(inputSet.has(a)).toBe(true)
        }
      }),
    )
  })

  it('union of real + category may not cover all inputs (equity: accounts are excluded from both)', () => {
    fc.assert(
      fc.property(arbAccountList, (accounts) => {
        const real = filterRealAccounts(accounts)
        const category = filterCategoryAccounts(accounts)
        const covered = new Set([...real, ...category])
        const uncovered = accounts.filter(a => !covered.has(a))
        // Every uncovered account must NOT start with assets:, liabilities:, expenses:, or income:
        for (const a of uncovered) {
          expect(a.startsWith('assets:')).toBe(false)
          expect(a.startsWith('liabilities:')).toBe(false)
          expect(a.startsWith('expenses:')).toBe(false)
          expect(a.startsWith('income:')).toBe(false)
        }
      }),
    )
  })
})
