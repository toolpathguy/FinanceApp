import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { validateSimplifiedForm } from './validateSimplifiedForm'
import type { SimplifiedFormState } from '~/types/ui'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Arbitrary: a valid YYYY-MM-DD date string */
const arbValidDate = fc
  .tuple(
    fc.integer({ min: 2000, max: 2099 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)

/** Arbitrary: a non-empty trimmed string (for payee, etc.) */
const arbNonEmptyString = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,19}$/)

/** Arbitrary: a real account path (assets: or liabilities:) */
const arbRealAccount = fc.oneof(
  fc.stringMatching(/^assets:[a-z]{2,10}$/).filter(s => s.length > 7),
  fc.stringMatching(/^liabilities:[a-z]{2,10}$/).filter(s => s.length > 13),
)

/** Arbitrary: a category account path (expenses: or income:) */
const arbCategoryAccount = fc.oneof(
  fc.stringMatching(/^expenses:[a-z]{2,10}$/).filter(s => s.length > 9),
  fc.stringMatching(/^income:[a-z]{2,10}$/).filter(s => s.length > 7),
)

/** Arbitrary: a positive numeric string */
const arbPositiveAmountStr = fc
  .double({ min: 0.01, max: 99999, noNaN: true })
  .map(n => n.toFixed(2))

/** Arbitrary: a valid status */
const arbStatus = fc.constantFrom('' as const, '!' as const, '*' as const)

/**
 * Arbitrary: a fully valid SimplifiedFormState.
 * Generates either an expense/income form (with category) or a transfer form (with transferAccount).
 */
const arbValidFormState: fc.Arbitrary<SimplifiedFormState> = fc.oneof(
  // Expense: outflow filled, category set
  fc.record({
    date: arbValidDate,
    payee: arbNonEmptyString,
    account: arbRealAccount,
    category: arbCategoryAccount,
    transferAccount: fc.constant(''),
    inflow: fc.constant(''),
    outflow: arbPositiveAmountStr,
    status: arbStatus,
  }),
  // Income: inflow filled, category set
  fc.record({
    date: arbValidDate,
    payee: arbNonEmptyString,
    account: arbRealAccount,
    category: arbCategoryAccount,
    transferAccount: fc.constant(''),
    inflow: arbPositiveAmountStr,
    outflow: fc.constant(''),
    status: arbStatus,
  }),
  // Transfer: inflow or outflow filled, transferAccount set, no category needed
  fc.tuple(arbRealAccount, arbRealAccount, arbPositiveAmountStr, fc.boolean())
    .filter(([src, dst]) => src !== dst)
    .chain(([src, dst, amt, useInflow]) =>
      fc.record({
        date: arbValidDate,
        payee: arbNonEmptyString,
        account: fc.constant(src),
        category: fc.constant(''),
        transferAccount: fc.constant(dst),
        inflow: fc.constant(useInflow ? amt : ''),
        outflow: fc.constant(useInflow ? '' : amt),
        status: arbStatus,
      }),
    ),
)

describe('validateSimplifiedForm — Property Tests', () => {
  /**
   * Property 9: Form validation rejects all invalid states
   *
   * For any SimplifiedFormState where at least one validation rule is violated,
   * validateSimplifiedForm should return a non-empty array of error messages.
   *
   * **Validates: Requirements 2.1–2.9**
   */

  it('Property 9a: empty payee → errors.length > 0', () => {
    fc.assert(
      fc.property(arbValidFormState, (state) => {
        const invalid = { ...state, payee: '   ' }
        const errors = validateSimplifiedForm(invalid)
        expect(errors.length).toBeGreaterThan(0)
      }),
    )
  })

  it('Property 9b: empty account → errors.length > 0', () => {
    fc.assert(
      fc.property(arbValidFormState, (state) => {
        const invalid = { ...state, account: '' }
        const errors = validateSimplifiedForm(invalid)
        expect(errors.length).toBeGreaterThan(0)
      }),
    )
  })

  it('Property 9c: both inflow and outflow filled → errors.length > 0', () => {
    fc.assert(
      fc.property(arbValidFormState, arbPositiveAmountStr, arbPositiveAmountStr, (state, inf, outf) => {
        const invalid = { ...state, inflow: inf, outflow: outf }
        const errors = validateSimplifiedForm(invalid)
        expect(errors.length).toBeGreaterThan(0)
      }),
    )
  })

  it('Property 9d: neither inflow nor outflow → errors.length > 0', () => {
    fc.assert(
      fc.property(arbValidFormState, (state) => {
        const invalid = { ...state, inflow: '', outflow: '' }
        const errors = validateSimplifiedForm(invalid)
        expect(errors.length).toBeGreaterThan(0)
      }),
    )
  })

  it('Property 9e: non-positive amount → errors.length > 0', () => {
    const arbBadAmount = fc.oneof(
      fc.constant('0'),
      fc.constant('-5'),
      fc.constant('abc'),
      fc.constant('0.00'),
      fc.double({ min: -9999, max: 0, noNaN: true }).map(n => n.toFixed(2)),
    )
    fc.assert(
      fc.property(arbValidFormState, arbBadAmount, fc.boolean(), (state, badAmt, useInflow) => {
        const invalid = {
          ...state,
          inflow: useInflow ? badAmt : '',
          outflow: useInflow ? '' : badAmt,
        }
        const errors = validateSimplifiedForm(invalid)
        expect(errors.length).toBeGreaterThan(0)
      }),
    )
  })

  it('Property 9f: missing category when not transfer → errors.length > 0', () => {
    fc.assert(
      fc.property(arbValidFormState, (state) => {
        const invalid = { ...state, category: '', transferAccount: '' }
        const errors = validateSimplifiedForm(invalid)
        expect(errors.length).toBeGreaterThan(0)
      }),
    )
  })

  it('Property 9g: same-account transfer → errors.length > 0', () => {
    fc.assert(
      fc.property(arbValidFormState, arbRealAccount, (state, acct) => {
        const invalid = { ...state, transferAccount: acct, account: acct }
        const errors = validateSimplifiedForm(invalid)
        expect(errors.length).toBeGreaterThan(0)
      }),
    )
  })

  it('Property 9h: invalid date format → errors.length > 0', () => {
    const arbBadDate = fc.oneof(
      fc.constant(''),
      fc.constant('01-15-2025'),
      fc.constant('2025/01/15'),
      fc.constant('not-a-date'),
      fc.constant('20250115'),
    )
    fc.assert(
      fc.property(arbValidFormState, arbBadDate, (state, badDate) => {
        const invalid = { ...state, date: badDate }
        const errors = validateSimplifiedForm(invalid)
        expect(errors.length).toBeGreaterThan(0)
      }),
    )
  })

  /**
   * Property 10: Form validation accepts all valid states
   *
   * For any SimplifiedFormState where all fields satisfy the validation rules
   * (valid date, non-empty payee, non-empty account, exactly one of inflow/outflow
   * with a positive numeric value, and appropriate category or transfer account),
   * validateSimplifiedForm should return an empty array.
   *
   * **Validates: Requirement 2.9**
   */

  it('Property 10: valid form states produce zero errors', () => {
    fc.assert(
      fc.property(arbValidFormState, (state) => {
        const errors = validateSimplifiedForm(state)
        expect(errors).toEqual([])
      }),
    )
  })
})
