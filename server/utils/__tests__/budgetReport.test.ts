import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getReadyToAssign } from '../budgetData'

// --- Mock Nitro auto-imported globals that budgetReport.ts relies on ---
const mockHledgerExec = vi.fn()
const mockHledgerExecText = vi.fn()

vi.stubGlobal('hledgerExec', mockHledgerExec)
vi.stubGlobal('hledgerExecText', mockHledgerExecText)
vi.stubGlobal('transformBalanceReport', (raw: any) => raw)
vi.stubGlobal('resolveBudgetBase', async () => 'assets:checking')
// Real RTA util — exercised with the base + cumulative report the caller passes.
vi.stubGlobal('getReadyToAssign', getReadyToAssign)

const { getBudgetReport } = await import('../budgetReport')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getBudgetReport', () => {
  it('builds Ready-to-Assign and per-envelope columns (no period)', async () => {
    mockHledgerExecText.mockResolvedValue(
      'assets:checking\nassets:checking:budget:rent\nexpenses:rent\nexpenses:food:groceries\n',
    )
    // Call order (no period): expense activity, cumulative budget, real accounts.
    mockHledgerExec
      .mockResolvedValueOnce({ rows: [
        { account: 'expenses:rent', amounts: [{ quantity: 1200, commodity: '$' }] },
        { account: 'expenses:food:groceries', amounts: [{ quantity: 50, commodity: '$' }] },
      ], totals: [] })
      .mockResolvedValueOnce({ rows: [
        { account: 'assets:checking:budget:rent', amounts: [{ quantity: 0, commodity: '$' }] },
        { account: 'assets:checking:budget:unallocated', amounts: [{ quantity: 300, commodity: '$' }] },
      ], totals: [] })
      .mockResolvedValueOnce({ rows: [], totals: [{ quantity: 1500, commodity: '$' }] })

    const report = await getBudgetReport('')

    // RTA = net real balance (1500) − envelopes (sum budget − unallocated = 0)
    expect(report.readyToAssign).toBe(1500)
    expect(report.period).toBe('')
    const rent = report.categoryGroups.flatMap(g => g.categories).find(c => c.accountPath === 'expenses:rent')
    expect(rent).toBeDefined()
    expect(rent!.activity).toBe(1200)
  })

  it('passes the period through to hledger when provided', async () => {
    mockHledgerExecText.mockResolvedValue('assets:checking\nexpenses:rent\n')
    mockHledgerExec.mockResolvedValue({ rows: [], totals: [{ quantity: 0, commodity: '$' }] })

    await getBudgetReport('2025-03')

    // Expense activity call carries -p <period>.
    expect(mockHledgerExec).toHaveBeenCalledWith(expect.arrayContaining(['-p', '2025-03']))
  })
})
