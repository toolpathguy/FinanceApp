import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// --- Mock Nitro globals ---

const mockAppendTransaction = vi.fn()
const mockSetResponseStatus = vi.fn()
const mockReadBody = vi.fn()

vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('readBody', mockReadBody)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  const err = new Error(opts.message) as any
  err.statusCode = opts.statusCode
  return err
})
vi.stubGlobal('setResponseStatus', mockSetResponseStatus)

vi.mock('../../utils/journalWriter', () => ({
  appendTransaction: (...args: any[]) => mockAppendTransaction(...args),
}))

const { default: budgetAssign } = await import('../budget/assign.post')
const fakeEvent = {} as any

beforeEach(() => {
  vi.clearAllMocks()
  mockAppendTransaction.mockResolvedValue(undefined)
})

// --- Arbitrary Helpers ---

/** Generates valid YYYY-MM-DD date strings */
function arbDate(): fc.Arbitrary<string> {
  return fc
    .record({
      year: fc.integer({ min: 2000, max: 2099 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
    })
    .map(({ year, month, day }) =>
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    )
}

/** Generates valid colon-separated lowercase account names (e.g., `assets:checking`) */
function arbPhysicalAccount(): fc.Arbitrary<string> {
  return fc
    .array(fc.stringMatching(/^[a-z]{2,10}$/), { minLength: 1, maxLength: 3 })
    .map((segments) => segments.join(':'))
}

/** Generates a unique set of envelope category names */
function arbEnvelopeCategory(): fc.Arbitrary<string> {
  return fc
    .array(fc.stringMatching(/^[a-z]{2,8}$/), { minLength: 1, maxLength: 3 })
    .map((segments) => segments.join(':'))
}

/** Generates a valid envelopes map: 1-5 entries with unique category names and positive amounts */
function arbEnvelopes(): fc.Arbitrary<Record<string, number>> {
  return fc
    .array(
      fc.record({
        category: arbEnvelopeCategory(),
        amount: fc.integer({ min: 1, max: 1000000 }).map((n) => n / 100),
      }),
      { minLength: 1, maxLength: 5 }
    )
    .filter((entries) => {
      const categories = entries.map((e) => e.category)
      return new Set(categories).size === categories.length
    })
    .map((entries) => {
      const envelopes: Record<string, number> = {}
      for (const { category, amount } of entries) {
        envelopes[category] = amount
      }
      return envelopes
    })
}

/** Generates a valid BudgetAssignRequest */
function arbBudgetAssignRequest() {
  return fc.record({
    date: arbDate(),
    physicalAccount: arbPhysicalAccount(),
    envelopes: arbEnvelopes(),
  })
}

// --- Property Tests ---

/**
 * Property P2: Budget assignment transactions always balance
 * Every budget assignment transaction has postings that sum to zero.
 *
 * **Validates: Requirements 4.1, 4.2**
 */
describe('P2: Budget assignment transactions always balance', () => {
  it('postings in the TransactionInput passed to appendTransaction sum to zero', async () => {
    await fc.assert(
      fc.asyncProperty(arbBudgetAssignRequest(), async (request) => {
        mockReadBody.mockResolvedValue(request)
        mockAppendTransaction.mockClear()

        await budgetAssign(fakeEvent)

        // appendTransaction must have been called exactly once
        expect(mockAppendTransaction).toHaveBeenCalledTimes(1)

        const transaction = mockAppendTransaction.mock.calls[0]![0]

        // Sum all posting amounts
        const sum = transaction.postings.reduce(
          (acc: number, p: { amount?: number }) => acc + (p.amount ?? 0),
          0
        )

        // Postings must sum to zero (within floating point tolerance)
        expect(Math.abs(sum)).toBeLessThanOrEqual(0.01)
      }),
      { numRuns: 200 }
    )
  })
})

const { default: postTransactions } = await import('../transactions.post')

// --- Arbitrary for Simplified Expense Input ---

/** Generates a valid simplified expense input with an asset account and expense category */
function arbSimplifiedExpense() {
  return fc.record({
    date: arbDate(),
    payee: fc.stringMatching(/^[a-zA-Z ]{2,20}$/).filter((s) => s.trim().length > 0),
    account: fc
      .array(fc.stringMatching(/^[a-z]{2,8}$/), { minLength: 1, maxLength: 2 })
      .map((segments) => `assets:${segments.join(':')}`),
    type: fc.constant('expense' as const),
    category: fc
      .array(fc.stringMatching(/^[a-z]{2,8}$/), { minLength: 1, maxLength: 2 })
      .map((segments) => `expenses:${segments.join(':')}`),
    amount: fc.integer({ min: 1, max: 1000000 }).map((n) => n / 100),
  })
}

// --- Property P5 ---

/**
 * Property P5: Expense transactions debit the correct envelope
 * When recording an expense with an envelope, the budget sub-account is debited,
 * not the physical account.
 *
 * **Validates: Requirements 5.1, 5.3**
 */
describe('P5: Expense transactions debit the correct envelope', () => {
  it('expense postings use budget sub-account, not the raw physical account', async () => {
    await fc.assert(
      fc.asyncProperty(arbSimplifiedExpense(), async (expense) => {
        mockReadBody.mockResolvedValue(expense)
        mockAppendTransaction.mockClear()

        await postTransactions(fakeEvent)

        expect(mockAppendTransaction).toHaveBeenCalledTimes(1)

        const transaction = mockAppendTransaction.mock.calls[0]![0]
        const postings: { account: string; amount?: number }[] = transaction.postings

        // At least one posting account must contain ':budget:'
        const hasBudgetPosting = postings.some((p) => p.account.includes(':budget:'))
        expect(hasBudgetPosting).toBe(true)

        // No posting should use the raw physical account directly
        const rawAccount = expense.account // e.g. 'assets:checking'
        const usesRawAccount = postings.some((p) => p.account === rawAccount)
        expect(usesRawAccount).toBe(false)

        // The budget sub-account should be {physicalAccount}:budget:{categoryWithoutExpensesPrefix}
        const expectedEnvelope = `${rawAccount}:budget:${expense.category.replace(/^expenses:/, '')}`
        const hasCorrectEnvelope = postings.some((p) => p.account === expectedEnvelope)
        expect(hasCorrectEnvelope).toBe(true)
      }),
      { numRuns: 200 }
    )
  })
})

