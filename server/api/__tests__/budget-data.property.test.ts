import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// --- Mock Nitro globals ---

const mockHledgerExec = vi.fn()
const mockHledgerExecText = vi.fn()
const mockTransformBalanceReport = vi.fn()
const mockGetQuery = vi.fn()

vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('getQuery', mockGetQuery)
vi.stubGlobal('hledgerExec', mockHledgerExec)
vi.stubGlobal('hledgerExecText', mockHledgerExecText)
vi.stubGlobal('transformBalanceReport', mockTransformBalanceReport)

vi.mock('node:fs', () => ({ existsSync: () => false }))
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))

const { default: getBudget } = await import('../budget.get')
const fakeEvent = {} as any

beforeEach(() => {
  vi.clearAllMocks()
  mockGetQuery.mockReturnValue({})
})

// --- Arbitrary Helpers ---

function arbExpenseCategory(): fc.Arbitrary<string> {
  return fc
    .array(fc.stringMatching(/^[a-z]{3,8}$/), { minLength: 1, maxLength: 2 })
    .map((segments) => `expenses:${segments.join(':')}`)
}

function arbBudgetScenario() {
  return fc
    .record({
      categories: fc
        .array(arbExpenseCategory(), { minLength: 1, maxLength: 5 })
        .filter((cats) => {
          if (new Set(cats).size !== cats.length) return false
          for (const a of cats) {
            for (const b of cats) {
              if (a !== b && b.startsWith(a + ':')) return false
            }
          }
          return true
        }),
      unallocatedBalance: fc.integer({ min: 0, max: 100000 }).map((n) => n / 100),
      savingsBalance: fc.integer({ min: 0, max: 50000 }).map((n) => n / 100),
      creditCardBalance: fc.integer({ min: 0, max: 10000 }).map((n) => n / 100),
    })
    .chain(({ categories, unallocatedBalance, savingsBalance, creditCardBalance }) => {
      return fc.record({
        categories: fc.constant(categories),
        unallocatedBalance: fc.constant(unallocatedBalance),
        savingsBalance: fc.constant(savingsBalance),
        creditCardBalance: fc.constant(creditCardBalance),
        activities: fc.array(
          fc.integer({ min: 0, max: 10000 }).map((n) => n / 100),
          { minLength: categories.length, maxLength: categories.length },
        ),
        budgetBalances: fc.array(
          fc.integer({ min: 0, max: 10000 }).map((n) => n / 100),
          { minLength: categories.length, maxLength: categories.length },
        ),
      })
    })
}

/**
 * Set up mocks for a scenario.
 * hledgerExec calls: expense activity, cumulative budget, real account totals
 */
function setupMocks(scenario: {
  categories: string[]
  unallocatedBalance: number
  savingsBalance: number
  creditCardBalance: number
  activities: number[]
  budgetBalances: number[]
}) {
  const { categories, unallocatedBalance, savingsBalance, creditCardBalance, activities, budgetBalances } = scenario

  mockHledgerExecText.mockResolvedValue(categories.join('\n') + '\n')

  // 3 hledgerExec calls
  mockHledgerExec
    .mockResolvedValueOnce({}) // expense activity
    .mockResolvedValueOnce({}) // cumulative budget
    .mockResolvedValueOnce({}) // real account totals

  const expenseRows = categories.map((cat, i) => ({
    account: cat,
    amounts: [{ commodity: '$', quantity: activities[i] }],
  }))

  const budgetRows = categories.map((cat, i) => {
    const budgetKey = cat.replace(/^expenses:/, '')
    return {
      account: `assets:checking:budget:${budgetKey}`,
      amounts: [{ commodity: '$', quantity: budgetBalances[i] }],
    }
  })
  budgetRows.push({
    account: 'assets:checking:budget:unallocated',
    amounts: [{ commodity: '$', quantity: unallocatedBalance }],
  })

  const totalBudget = budgetBalances.reduce((s, b) => s + b, 0) + unallocatedBalance
  // checking = sum of all budget sub-accounts
  const checkingBalance = totalBudget
  const netReal = checkingBalance + savingsBalance - creditCardBalance

  mockTransformBalanceReport
    .mockReturnValueOnce({ rows: expenseRows, totals: [] })
    .mockReturnValueOnce({
      rows: budgetRows,
      totals: [{ commodity: '$', quantity: totalBudget }],
    })
    .mockReturnValueOnce({
      rows: [
        { account: 'assets:checking', amounts: [{ commodity: '$', quantity: checkingBalance }] },
        ...(savingsBalance > 0 ? [{ account: 'assets:savings', amounts: [{ commodity: '$', quantity: savingsBalance }] }] : []),
        ...(creditCardBalance > 0 ? [{ account: 'liabilities:credit-card', amounts: [{ commodity: '$', quantity: -creditCardBalance }] }] : []),
      ],
      totals: [{ commodity: '$', quantity: netReal }],
    })
}

// --- Property Tests ---

/**
 * Property P3: Ready to Assign = net real accounts - envelope balances
 * YNAB Rule 1: every dollar has a job. Ready to Assign captures all unassigned money
 * across all real accounts (checking, savings, credit cards).
 *
 * **Validates: Requirements 7.1**
 */
describe('P3: Ready to Assign equals net real minus envelopes', () => {
  it('readyToAssign = net real balance - sum of envelope Available', async () => {
    await fc.assert(
      fc.asyncProperty(arbBudgetScenario(), async (scenario) => {
        setupMocks(scenario)

        const result = await getBudget(fakeEvent)

        const totalEnvelopes = scenario.budgetBalances.reduce((s, b) => s + b, 0)
        const checkingBalance = totalEnvelopes + scenario.unallocatedBalance
        const netReal = checkingBalance + scenario.savingsBalance - scenario.creditCardBalance
        const expected = netReal - totalEnvelopes

        expect(result.readyToAssign).toBeCloseTo(expected, 1)
      }),
      { numRuns: 200 },
    )
  })
})

/**
 * Property P4: Available equals envelope balance
 * Each envelope's Available amount equals the corresponding budget sub-account balance.
 *
 * **Validates: Requirements 7.2**
 */
describe('P4: Available equals envelope balance', () => {
  it('each category available equals its budget sub-account balance', async () => {
    await fc.assert(
      fc.asyncProperty(arbBudgetScenario(), async (scenario) => {
        setupMocks(scenario)

        const result = await getBudget(fakeEvent)

        const allCategories = result.categoryGroups.flatMap(
          (g: { categories: { accountPath: string; available: number }[] }) => g.categories,
        )

        for (let i = 0; i < scenario.categories.length; i++) {
          const expenseAccount = scenario.categories[i]
          const expectedAvailable = scenario.budgetBalances[i]

          const found = allCategories.find(
            (c: { accountPath: string }) => c.accountPath === expenseAccount,
          )

          expect(found).toBeDefined()
          expect(found!.available).toBe(expectedAvailable)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('available is 0 when no budget sub-account exists for a category', async () => {
    await fc.assert(
      fc.asyncProperty(arbBudgetScenario(), async (scenario) => {
        const { categories, activities } = scenario

        mockHledgerExecText.mockResolvedValue(categories.join('\n') + '\n')
        mockHledgerExec
          .mockResolvedValueOnce({}) // expense
          .mockResolvedValueOnce({}) // budget (empty)
          .mockResolvedValueOnce({}) // real accounts

        const expenseRows = categories.map((cat, i) => ({
          account: cat,
          amounts: [{ commodity: '$', quantity: activities[i] }],
        }))

        mockTransformBalanceReport
          .mockReturnValueOnce({ rows: expenseRows, totals: [] })
          .mockReturnValueOnce({ rows: [], totals: [] })
          .mockReturnValueOnce({ rows: [], totals: [] })

        const result = await getBudget(fakeEvent)

        const allCategories = result.categoryGroups.flatMap(
          (g: { categories: { accountPath: string; available: number }[] }) => g.categories,
        )

        for (const expenseAccount of categories) {
          const found = allCategories.find(
            (c: { accountPath: string }) => c.accountPath === expenseAccount,
          )
          expect(found).toBeDefined()
          expect(found!.available).toBe(0)
        }
      }),
      { numRuns: 100 },
    )
  })
})
