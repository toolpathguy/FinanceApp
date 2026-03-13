import { describe, it, expect, vi, beforeEach } from 'vitest'

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

// Mock node:fs modules used by loadHiddenEnvelopes
vi.mock('node:fs', () => ({
  existsSync: () => false,
}))
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}))

const { default: getBudget } = await import('../budget.get')
const fakeEvent = {} as any

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * GET /api/budget — budget data reading
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 *
 * hledgerExec call order (no period):
 *   1. bal expenses:                    → expense activity
 *   2. bal assets:checking:budget:      → cumulative budget balances
 *   3. bal assets: liabilities:         → real account totals (for Ready to Assign)
 *
 * hledgerExec call order (with period):
 *   1. bal expenses: -p <period>        → period expense activity
 *   2. bal assets:checking:budget:      → cumulative budget balances
 *   3. bal assets: liabilities:         → real account totals
 *   4. bal assets:checking:budget: -p   → period budget delta
 */
describe('GET /api/budget', () => {
  it('returns correct Available, Assigned, Activity, and Ready to Assign values', async () => {
    mockGetQuery.mockReturnValue({})

    mockHledgerExecText.mockResolvedValue(
      'expenses:food:groceries\nexpenses:housing:rent\n',
    )

    // 3 hledgerExec calls: expense activity, cumulative budget, real accounts
    mockHledgerExec
      .mockResolvedValueOnce({}) // expense activity
      .mockResolvedValueOnce({}) // cumulative budget
      .mockResolvedValueOnce({}) // real account totals

    mockTransformBalanceReport
      // 1st: expense activity
      .mockReturnValueOnce({
        rows: [
          { account: 'expenses:food:groceries', amounts: [{ commodity: '$', quantity: 110 }] },
          { account: 'expenses:housing:rent', amounts: [{ commodity: '$', quantity: 1200 }] },
        ],
        totals: [{ commodity: '$', quantity: 1310 }],
      })
      // 2nd: cumulative budget balances
      .mockReturnValueOnce({
        rows: [
          { account: 'assets:checking:budget:food:groceries', amounts: [{ commodity: '$', quantity: 290 }] },
          { account: 'assets:checking:budget:housing:rent', amounts: [{ commodity: '$', quantity: 0 }] },
          { account: 'assets:checking:budget:unallocated', amounts: [{ commodity: '$', quantity: 500 }] },
        ],
        totals: [{ commodity: '$', quantity: 790 }],
      })
      // 3rd: real account totals — net worth = 790 (all in checking sub-accounts)
      // Ready to Assign = 790 - (290 + 0) envelopes = 500
      .mockReturnValueOnce({
        rows: [
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: 790 }] },
        ],
        totals: [{ commodity: '$', quantity: 790 }],
      })

    const result = await getBudget(fakeEvent)

    // Ready to Assign = net real (790) - envelope balances (290 + 0) = 500
    expect(result.readyToAssign).toBe(500)

    const foodGroup = result.categoryGroups.find((g: any) => g.name === 'Food')
    const housingGroup = result.categoryGroups.find((g: any) => g.name === 'Housing')

    expect(foodGroup).toBeDefined()
    expect(housingGroup).toBeDefined()

    const groceries = foodGroup!.categories.find((c: any) => c.accountPath === 'expenses:food:groceries')
    const rent = housingGroup!.categories.find((c: any) => c.accountPath === 'expenses:housing:rent')

    expect(groceries).toBeDefined()
    expect(rent).toBeDefined()

    expect(groceries!.available).toBe(290)
    expect(groceries!.activity).toBe(110)
    expect(groceries!.assigned).toBe(400)

    expect(rent!.available).toBe(0)
    expect(rent!.activity).toBe(1200)
    expect(rent!.assigned).toBe(1200)
  })

  it('returns period-scoped Assigned and Activity with cumulative Available when period is set', async () => {
    mockGetQuery.mockReturnValue({ period: '2025-03' })

    mockHledgerExecText.mockResolvedValue('expenses:food:groceries\n')

    // 4 hledgerExec calls with period
    mockHledgerExec
      .mockResolvedValueOnce({}) // period expense activity
      .mockResolvedValueOnce({}) // cumulative budget
      .mockResolvedValueOnce({}) // real account totals
      .mockResolvedValueOnce({}) // period budget delta

    mockTransformBalanceReport
      // 1st: period expense activity = $80 spent this month
      .mockReturnValueOnce({
        rows: [{ account: 'expenses:food:groceries', amounts: [{ commodity: '$', quantity: 80 }] }],
        totals: [{ commodity: '$', quantity: 80 }],
      })
      // 2nd: cumulative budget = $320 available + $100 unallocated
      .mockReturnValueOnce({
        rows: [
          { account: 'assets:checking:budget:food:groceries', amounts: [{ commodity: '$', quantity: 320 }] },
          { account: 'assets:checking:budget:unallocated', amounts: [{ commodity: '$', quantity: 100 }] },
        ],
        totals: [{ commodity: '$', quantity: 420 }],
      })
      // 3rd: real account totals = $420 net worth
      // Ready to Assign = 420 - 320 envelopes = 100
      .mockReturnValueOnce({
        rows: [{ account: 'assets:checking', amounts: [{ commodity: '$', quantity: 420 }] }],
        totals: [{ commodity: '$', quantity: 420 }],
      })
      // 4th: period delta = $320 (assigned $400 - spent $80)
      .mockReturnValueOnce({
        rows: [{ account: 'assets:checking:budget:food:groceries', amounts: [{ commodity: '$', quantity: 320 }] }],
        totals: [{ commodity: '$', quantity: 320 }],
      })

    const result = await getBudget(fakeEvent)

    expect(result.readyToAssign).toBe(100)

    const foodGroup = result.categoryGroups.find((g: any) => g.name === 'Food')
    const groceries = foodGroup!.categories.find((c: any) => c.accountPath === 'expenses:food:groceries')

    expect(groceries!.activity).toBe(80)
    expect(groceries!.available).toBe(320)
    expect(groceries!.assigned).toBe(400)
  })

  it('returns $0 for all budget values when no budget sub-accounts exist', async () => {
    mockGetQuery.mockReturnValue({})

    mockHledgerExecText.mockResolvedValue('expenses:food:groceries\n')

    mockHledgerExec
      .mockResolvedValueOnce({}) // expense activity
      // Budget query throws — no budget sub-accounts yet
      .mockRejectedValueOnce(new Error('No matching accounts'))

    mockTransformBalanceReport.mockReturnValueOnce({
      rows: [
        { account: 'expenses:food:groceries', amounts: [{ commodity: '$', quantity: 50 }] },
      ],
      totals: [{ commodity: '$', quantity: 50 }],
    })

    const result = await getBudget(fakeEvent)

    expect(result.readyToAssign).toBe(0)

    const foodGroup = result.categoryGroups.find((g: any) => g.name === 'Food')
    expect(foodGroup).toBeDefined()

    const groceries = foodGroup!.categories.find((c: any) => c.accountPath === 'expenses:food:groceries')
    expect(groceries).toBeDefined()

    expect(groceries!.available).toBe(0)
    expect(groceries!.activity).toBe(50)
    expect(groceries!.assigned).toBe(50)
  })

  it('returns correct Ready to Assign from unallocated balance only', async () => {
    mockGetQuery.mockReturnValue({})

    mockHledgerExecText.mockResolvedValue('')

    mockHledgerExec
      .mockResolvedValueOnce({}) // expense bal (empty)
      .mockResolvedValueOnce({}) // cumulative budget
      .mockResolvedValueOnce({}) // real account totals

    mockTransformBalanceReport
      .mockReturnValueOnce({ rows: [], totals: [] })
      // cumulative budget: only unallocated
      .mockReturnValueOnce({
        rows: [
          { account: 'assets:checking:budget:unallocated', amounts: [{ commodity: '$', quantity: 3500 }] },
        ],
        totals: [{ commodity: '$', quantity: 3500 }],
      })
      // real accounts: $3500 in checking
      .mockReturnValueOnce({
        rows: [{ account: 'assets:checking', amounts: [{ commodity: '$', quantity: 3500 }] }],
        totals: [{ commodity: '$', quantity: 3500 }],
      })

    const result = await getBudget(fakeEvent)

    // Ready to Assign = 3500 net - 0 envelopes = 3500
    expect(result.readyToAssign).toBe(3500)
    expect(result.categoryGroups).toEqual([])
    expect(result.totalAssigned).toBe(0)
    expect(result.totalActivity).toBe(0)
    expect(result.totalAvailable).toBe(0)
  })

  it('includes savings and credit card in Ready to Assign (YNAB Rule 1)', async () => {
    mockGetQuery.mockReturnValue({})

    mockHledgerExecText.mockResolvedValue('expenses:food:groceries\n')

    mockHledgerExec
      .mockResolvedValueOnce({}) // expense activity
      .mockResolvedValueOnce({}) // cumulative budget
      .mockResolvedValueOnce({}) // real account totals

    mockTransformBalanceReport
      .mockReturnValueOnce({
        rows: [{ account: 'expenses:food:groceries', amounts: [{ commodity: '$', quantity: 100 }] }],
        totals: [{ commodity: '$', quantity: 100 }],
      })
      // Budget: $300 in groceries envelope, $200 unallocated
      .mockReturnValueOnce({
        rows: [
          { account: 'assets:checking:budget:food:groceries', amounts: [{ commodity: '$', quantity: 300 }] },
          { account: 'assets:checking:budget:unallocated', amounts: [{ commodity: '$', quantity: 200 }] },
        ],
        totals: [{ commodity: '$', quantity: 500 }],
      })
      // Real accounts: checking $500 + savings $1000 - credit card -$50 = $1450 net
      .mockReturnValueOnce({
        rows: [
          { account: 'assets:checking', amounts: [{ commodity: '$', quantity: 500 }] },
          { account: 'assets:savings', amounts: [{ commodity: '$', quantity: 1000 }] },
          { account: 'liabilities:credit-card', amounts: [{ commodity: '$', quantity: -50 }] },
        ],
        totals: [{ commodity: '$', quantity: 1450 }],
      })

    const result = await getBudget(fakeEvent)

    // Ready to Assign = net real ($1450) - envelope balances ($300) = $1150
    // This includes savings ($1000) and accounts for CC debt (-$50)
    expect(result.readyToAssign).toBe(1150)
    expect(result.totalAvailable).toBe(300)
  })
})
