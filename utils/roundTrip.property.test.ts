import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { toTransactionInput } from './toTransactionInput'
import { toRegisterRows } from './toRegisterRows'
import type { SimplifiedTransactionInput } from '~/types/ui'
import type { HledgerTransaction } from '~/types/hledger'
import type { TransactionInput } from '~/types/api'

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Simulates what hledger would return for a given TransactionInput.
 * Converts the API posting format into the hledger JSON output format.
 */
function txInputToHledgerTx(txInput: TransactionInput, index: number): HledgerTransaction {
  return {
    date: txInput.date,
    description: txInput.description,
    status: (txInput.status ?? '*') as '' | '!' | '*',
    index,
    postings: txInput.postings.map(p => ({
      account: p.account,
      amounts: [{ commodity: p.commodity ?? '$', quantity: p.amount ?? 0 }],
    })),
  }
}

// ─── Generators (reused from toTransactionInput.property.test.ts) ───────────

const arbDate = fc
  .tuple(
    fc.integer({ min: 2000, max: 2099 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)

const arbPayee = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,29}$/)

const arbRealAccount = fc.oneof(
  fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/).map(s => `assets:${s}`),
  fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/).map(s => `liabilities:${s}`),
)

const arbAmount = fc.double({ min: 0.01, max: 999999, noNaN: true, noDefaultInfinity: true })
  .map(n => Math.round(n * 100) / 100)
  .filter(n => n > 0)

const arbExpenseInput: fc.Arbitrary<SimplifiedTransactionInput> = fc
  .tuple(arbDate, arbPayee, arbRealAccount, fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/).map(s => `expenses:${s}`), arbAmount)
  .map(([date, payee, account, category, amount]) => ({
    date, payee, account, type: 'expense' as const, category, amount,
  }))

const arbIncomeInput: fc.Arbitrary<SimplifiedTransactionInput> = fc
  .tuple(arbDate, arbPayee, arbRealAccount, fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/).map(s => `income:${s}`), arbAmount)
  .map(([date, payee, account, category, amount]) => ({
    date, payee, account, type: 'income' as const, category, amount,
  }))

const arbTransferInput: fc.Arbitrary<SimplifiedTransactionInput> = fc
  .tuple(arbDate, arbPayee, arbRealAccount, arbRealAccount, arbAmount)
  .filter(([, , account, transferAccount]) => account !== transferAccount)
  .map(([date, payee, account, transferAccount, amount]) => ({
    date, payee, account, type: 'transfer' as const, transferAccount, amount,
  }))

const arbSimplifiedTransactionInput: fc.Arbitrary<SimplifiedTransactionInput> = fc.oneof(
  arbExpenseInput,
  arbIncomeInput,
  arbTransferInput,
)

// ─── Property Test ──────────────────────────────────────────────────────────

describe('Round-trip conversion — Property Tests', () => {
  /**
   * Property 8: Transaction type round-trip through conversion and register
   *
   * For any valid SimplifiedTransactionInput:
   * 1. Convert to TransactionInput via toTransactionInput()
   * 2. Convert that TransactionInput to an HledgerTransaction (simulate hledger output)
   * 3. Pass through toRegisterRows() with the input's account
   * 4. Verify:
   *    - rows[0].isTransfer === (input.type === 'transfer')
   *    - input.type === 'expense' → rows[0].outflow === input.amount
   *    - input.type === 'income' → rows[0].inflow === input.amount
   *    - input.type === 'transfer' → rows[0].outflow === input.amount (money leaving source)
   *
   * **Validates: Requirements 3.1, 3.2, 3.3, 5.2, 5.3**
   */
  it('Property 8: round-trip preserves transaction type, inflow, and outflow', () => {
    fc.assert(
      fc.property(arbSimplifiedTransactionInput, (input) => {
        // Step 1: Convert to TransactionInput
        const txInput = toTransactionInput(input)

        // Step 2: Simulate hledger output
        const hledgerTx = txInputToHledgerTx(txInput, 0)

        // Step 3: Derive register rows for the source account
        const rows = toRegisterRows([hledgerTx], input.account)

        expect(rows).toHaveLength(1)
        const row = rows[0]

        // Verify transfer detection
        expect(row.isTransfer).toBe(input.type === 'transfer')

        // Verify amount direction by type
        if (input.type === 'expense') {
          expect(row.outflow).toBeCloseTo(input.amount, 2)
          expect(row.inflow).toBeNull()
        }
        else if (input.type === 'income') {
          expect(row.inflow).toBeCloseTo(input.amount, 2)
          expect(row.outflow).toBeNull()
        }
        else {
          // transfer — money leaves source account
          expect(row.outflow).toBeCloseTo(input.amount, 2)
          expect(row.inflow).toBeNull()
        }
      }),
    )
  })
})
