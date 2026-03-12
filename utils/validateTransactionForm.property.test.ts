import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { validateTransactionForm } from './validateTransactionForm'
import type { TransactionFormState } from '../types/ui'

/**
 * Arbitrary: generates a valid YYYY-MM-DD date string.
 */
const validDateArb = fc
  .record({
    year: fc.integer({ min: 1900, max: 2099 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  )

/**
 * Arbitrary: generates a non-empty, non-whitespace-only description string.
 */
const nonEmptyStringArb = fc.stringMatching(/^[a-zA-Z0-9 ]{1,30}$/).filter(s => s.trim().length > 0)

/**
 * Arbitrary: generates a posting with a non-empty account.
 */
const validPostingArb = fc.record({
  account: nonEmptyStringArb,
  amount: fc.string(),
  commodity: fc.string(),
})

/**
 * Arbitrary: generates a valid TransactionFormState status.
 */
const statusArb = fc.constantFrom('' as const, '!' as const, '*' as const)

/**
 * Arbitrary: generates a fully valid TransactionFormState.
 */
const validFormArb = fc.record({
  date: validDateArb,
  description: nonEmptyStringArb,
  postings: fc.array(validPostingArb, { minLength: 2, maxLength: 6 }),
  status: statusArb,
})

describe('validateTransactionForm — Property Tests', () => {
  /**
   * Property 5: Valid transaction forms pass validation
   *
   * For any TransactionFormState with a date matching YYYY-MM-DD, a non-empty description,
   * and at least 2 postings each with a non-empty account, validateTransactionForm returns
   * an empty array.
   *
   * **Validates: Requirement 5.1**
   */
  it('Property 5: valid forms return an empty error array', () => {
    fc.assert(
      fc.property(validFormArb, (form) => {
        const errors = validateTransactionForm(form)
        expect(errors).toEqual([])
      }),
    )
  })

  /**
   * Property 6: Invalid transaction forms fail validation
   *
   * For any TransactionFormState that violates at least one rule (invalid date format,
   * empty description, fewer than 2 postings, or any posting with an empty account),
   * validateTransactionForm returns a non-empty array of error messages.
   *
   * **Validates: Requirements 5.2, 5.4, 5.5**
   */
  it('Property 6: invalid forms return a non-empty error array', () => {
    /**
     * Strategy: generate a valid form, then corrupt exactly one field to guarantee
     * at least one violation. We use oneof to pick which rule to break.
     */

    /** Invalid date: empty or wrong format */
    const invalidDateArb = fc.oneof(
      fc.constant(''),
      fc.stringMatching(/^[a-z]{1,10}$/),
      // Wrong separators or missing parts
      fc.record({
        month: fc.integer({ min: 1, max: 12 }),
        day: fc.integer({ min: 1, max: 28 }),
      }).map(({ month, day }) => `${month}/${day}`),
    )

    /** Empty or whitespace-only description */
    const emptyDescriptionArb = fc.oneof(
      fc.constant(''),
      fc.constant('   '),
      fc.constant('\t'),
    )

    /** Fewer than 2 postings (0 or 1) */
    const tooFewPostingsArb = fc.oneof(
      fc.constant([] as { account: string; amount: string; commodity: string }[]),
      fc.array(validPostingArb, { minLength: 1, maxLength: 1 }),
    )

    /** Postings where at least one has an empty account */
    const postingsWithEmptyAccountArb = fc
      .array(validPostingArb, { minLength: 2, maxLength: 5 })
      .chain((postings) => {
        // Pick a random index to make empty
        return fc.integer({ min: 0, max: postings.length - 1 }).map((idx) => {
          const corrupted = [...postings]
          corrupted[idx] = { ...corrupted[idx]!, account: '' }
          return corrupted
        })
      })

    const invalidFormArb = fc.oneof(
      // Case 1: invalid date
      fc.record({
        date: invalidDateArb,
        description: nonEmptyStringArb,
        postings: fc.array(validPostingArb, { minLength: 2, maxLength: 5 }),
        status: statusArb,
      }),
      // Case 2: empty description
      fc.record({
        date: validDateArb,
        description: emptyDescriptionArb,
        postings: fc.array(validPostingArb, { minLength: 2, maxLength: 5 }),
        status: statusArb,
      }),
      // Case 3: fewer than 2 postings
      fc.record({
        date: validDateArb,
        description: nonEmptyStringArb,
        postings: tooFewPostingsArb,
        status: statusArb,
      }),
      // Case 4: posting with empty account
      fc.record({
        date: validDateArb,
        description: nonEmptyStringArb,
        postings: postingsWithEmptyAccountArb,
        status: statusArb,
      }),
    )

    fc.assert(
      fc.property(invalidFormArb, (form) => {
        const errors = validateTransactionForm(form)
        expect(errors.length).toBeGreaterThan(0)
      }),
    )
  })
})
