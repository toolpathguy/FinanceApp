import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { toTransactionInput } from './toTransactionInput'
import type { SimplifiedTransactionInput } from '~/types/ui'

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generates a valid YYYY-MM-DD date string */
const arbDate = fc
  .tuple(
    fc.integer({ min: 2000, max: 2099 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)

/** Generates a non-empty payee string */
const arbPayee = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,29}$/)

/** Generates a valid real account (assets: or liabilities:) */
const arbRealAccount = fc.oneof(
  fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/).map(s => `assets:${s}`),
  fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/).map(s => `liabilities:${s}`),
)

/** Generates a positive amount */
const arbAmount = fc.double({ min: 0.01, max: 999999, noNaN: true, noDefaultInfinity: true })
  .map(n => Math.round(n * 100) / 100)
  .filter(n => n > 0)

/** Generates a valid expense SimplifiedTransactionInput */
const arbExpenseInput: fc.Arbitrary<SimplifiedTransactionInput> = fc
  .tuple(arbDate, arbPayee, arbRealAccount, fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/).map(s => `expenses:${s}`), arbAmount)
  .map(([date, payee, account, category, amount]) => ({
    date,
    payee,
    account,
    type: 'expense' as const,
    category,
    amount,
  }))

/** Generates a valid income SimplifiedTransactionInput */
const arbIncomeInput: fc.Arbitrary<SimplifiedTransactionInput> = fc
  .tuple(arbDate, arbPayee, arbRealAccount, fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/).map(s => `income:${s}`), arbAmount)
  .map(([date, payee, account, category, amount]) => ({
    date,
    payee,
    account,
    type: 'income' as const,
    category,
    amount,
  }))

/** Generates a valid transfer SimplifiedTransactionInput (transferAccount differs from account) */
const arbTransferInput: fc.Arbitrary<SimplifiedTransactionInput> = fc
  .tuple(arbDate, arbPayee, arbRealAccount, arbRealAccount, arbAmount)
  .filter(([, , account, transferAccount]) => account !== transferAccount)
  .map(([date, payee, account, transferAccount, amount]) => ({
    date,
    payee,
    account,
    type: 'transfer' as const,
    transferAccount,
    amount,
  }))

/** Generates any valid SimplifiedTransactionInput */
const arbSimplifiedTransactionInput: fc.Arbitrary<SimplifiedTransactionInput> = fc.oneof(
  arbExpenseInput,
  arbIncomeInput,
  arbTransferInput,
)

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('toTransactionInput — Property Tests', () => {
  /**
   * Property 1: Transaction conversion always produces balanced postings
   *
   * For any valid SimplifiedTransactionInput, calling toTransactionInput should produce
   * a TransactionInput with exactly two postings whose amounts sum to zero.
   *
   * **Validates: Requirements 4.1, 4.2**
   */
  it('Property 1: always produces exactly 2 postings that sum to zero', () => {
    fc.assert(
      fc.property(arbSimplifiedTransactionInput, (input) => {
        const result = toTransactionInput(input)

        expect(result.postings).toHaveLength(2)

        const sum = result.postings[0].amount! + result.postings[1].amount!
        expect(Math.abs(sum)).toBeLessThan(1e-10)
      }),
    )
  })

  /**
   * Property 2: Transaction conversion maps posting accounts correctly by type
   *
   * For any valid SimplifiedTransactionInput, the two posting accounts in the output
   * should match the expected pattern for the transaction type.
   *
   * **Validates: Requirements 4.3, 4.4, 4.5**
   */
  it('Property 2: expense maps posting[0] to expense category, posting[1] to source account', () => {
    fc.assert(
      fc.property(arbExpenseInput, (input) => {
        const result = toTransactionInput(input)

        expect(result.postings[0].account).toBe(input.category)
        expect(result.postings[0].account.startsWith('expenses:')).toBe(true)
        expect(result.postings[1].account).toBe(input.account)
      }),
    )
  })

  it('Property 2: income maps posting[0] to destination account, posting[1] to income category', () => {
    fc.assert(
      fc.property(arbIncomeInput, (input) => {
        const result = toTransactionInput(input)

        expect(result.postings[0].account).toBe(input.account)
        expect(result.postings[1].account).toBe(input.category)
        expect(result.postings[1].account.startsWith('income:')).toBe(true)
      }),
    )
  })

  it('Property 2: transfer maps posting[0] to transfer target, posting[1] to source account', () => {
    fc.assert(
      fc.property(arbTransferInput, (input) => {
        const result = toTransactionInput(input)

        expect(result.postings[0].account).toBe(input.transferAccount)
        expect(result.postings[1].account).toBe(input.account)
      }),
    )
  })

  /**
   * Property 3: Transaction conversion preserves date and payee
   *
   * For any valid SimplifiedTransactionInput, the TransactionInput returned should have
   * its description equal to the input payee and its date equal to the input date.
   *
   * **Validates: Requirements 4.6, 4.7**
   */
  it('Property 3: result.description === input.payee and result.date === input.date', () => {
    fc.assert(
      fc.property(arbSimplifiedTransactionInput, (input) => {
        const result = toTransactionInput(input)

        expect(result.description).toBe(input.payee)
        expect(result.date).toBe(input.date)
      }),
    )
  })
})
