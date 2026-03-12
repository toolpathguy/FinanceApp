import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { deriveTransactionType } from './deriveTransactionType'
import type { SimplifiedFormState } from '~/types/ui'

/**
 * Arbitrary: generates a non-empty amount string (positive decimal number).
 */
const nonEmptyAmountArb = fc
  .tuple(
    fc.integer({ min: 1, max: 99999 }),
    fc.integer({ min: 0, max: 99 }),
  )
  .map(([whole, cents]) => `${whole}.${String(cents).padStart(2, '0')}`)

/**
 * Arbitrary: generates a non-empty transfer account path.
 */
const transferAccountArb = fc.constantFrom(
  'assets:savings',
  'assets:checking',
  'liabilities:credit-card',
  'assets:bank:savings',
)

const statusArb = fc.constantFrom('' as const, '!' as const, '*' as const)

/**
 * Helper to build a full SimplifiedFormState from partial overrides.
 */
function makeFormState(overrides: Partial<SimplifiedFormState> = {}): SimplifiedFormState {
  return {
    date: '2025-01-15',
    payee: 'Test',
    account: 'assets:checking',
    category: '',
    transferAccount: '',
    inflow: '',
    outflow: '',
    status: '*',
    ...overrides,
  }
}

describe('deriveTransactionType — Property Tests', () => {
  /**
   * Property 11: Transaction type derivation correctness
   *
   * For any SimplifiedFormState, deriveTransactionType should return "transfer"
   * when transferAccount is non-empty, "income" when inflow is non-empty and
   * outflow is empty and transferAccount is empty, and "expense" when outflow
   * is non-empty and inflow is empty and transferAccount is empty.
   *
   * **Validates: Requirements 3.1, 3.2, 3.3**
   */

  it('Property 11a: returns "transfer" when transferAccount is non-empty, regardless of inflow/outflow', () => {
    fc.assert(
      fc.property(
        transferAccountArb,
        fc.oneof(nonEmptyAmountArb, fc.constant('')),
        fc.oneof(nonEmptyAmountArb, fc.constant('')),
        statusArb,
        (transferAccount, inflow, outflow, status) => {
          const state = makeFormState({ transferAccount, inflow, outflow, status })
          expect(deriveTransactionType(state)).toBe('transfer')
        },
      ),
    )
  })

  it('Property 11b: returns "income" when inflow is non-empty, outflow is empty, and transferAccount is empty', () => {
    fc.assert(
      fc.property(
        nonEmptyAmountArb,
        statusArb,
        (inflow, status) => {
          const state = makeFormState({ inflow, outflow: '', transferAccount: '', status })
          expect(deriveTransactionType(state)).toBe('income')
        },
      ),
    )
  })

  it('Property 11c: returns "expense" when outflow is non-empty, inflow is empty, and transferAccount is empty', () => {
    fc.assert(
      fc.property(
        nonEmptyAmountArb,
        statusArb,
        (outflow, status) => {
          const state = makeFormState({ outflow, inflow: '', transferAccount: '', status })
          expect(deriveTransactionType(state)).toBe('expense')
        },
      ),
    )
  })

  it('Property 11d: throws when both inflow and outflow are non-empty and transferAccount is empty', () => {
    fc.assert(
      fc.property(
        nonEmptyAmountArb,
        nonEmptyAmountArb,
        statusArb,
        (inflow, outflow, status) => {
          const state = makeFormState({ inflow, outflow, transferAccount: '', status })
          expect(() => deriveTransactionType(state)).toThrow()
        },
      ),
    )
  })
})
