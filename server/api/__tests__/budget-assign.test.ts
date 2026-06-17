import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveBudgetBase } from '../../utils/hledger'
import { getReadyToAssign } from '../../utils/budgetData'

/**
 * POST /api/budget/assign — availability gate (GitHub Issue #7)
 *
 * You can't assign money that doesn't exist. "Money that exists" is Ready to
 * Assign = net worth across ALL real accounts − envelopes, so savings-held funds
 * count even when the host account is empty. These tests drive the real
 * `getReadyToAssign` over mocked hledger output, so they exercise the gate
 * end-to-end (including the net-worth basis), not just a stubbed number.
 *
 * getReadyToAssign() (called with no inputs from the endpoint) issues:
 *   1. hledgerExecText(['accounts'])            → resolveBudgetBase
 *   2. hledgerExec(['bal', '<base>:budget:'])   → cumulative budget balances
 *   3. hledgerExec(['bal', 'assets:', 'liabilities:']) → net worth
 */

const mockAppendTransaction = vi.fn()
const mockSetResponseStatus = vi.fn()
const mockReadBody = vi.fn()
const mockHledgerExec = vi.fn()
const mockHledgerExecText = vi.fn()
const mockTransformBalanceReport = vi.fn()

vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('readBody', mockReadBody)
vi.stubGlobal('setResponseStatus', mockSetResponseStatus)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  const err = new Error(opts.message) as any
  err.statusCode = opts.statusCode
  return err
})
vi.stubGlobal('hledgerExec', mockHledgerExec)
vi.stubGlobal('hledgerExecText', mockHledgerExecText)
vi.stubGlobal('transformBalanceReport', mockTransformBalanceReport)
vi.stubGlobal('resolveBudgetBase', resolveBudgetBase)
vi.stubGlobal('getReadyToAssign', getReadyToAssign)

vi.mock('../../utils/journalWriter', () => ({
  appendTransaction: (...args: any[]) => mockAppendTransaction(...args),
}))

const { default: budgetAssign } = await import('../budget/assign.post')
const fakeEvent = {} as any

/**
 * Make `getReadyToAssign()` report `netWorth − envelopes`.
 * @param realRows real-account balance rows (assets/liabilities), summing to netWorth
 * @param envelopes total in named envelopes (non-unallocated budget sub-accounts)
 */
function stubReadyToAssign(opts: {
  netWorth: number
  envelopes: number
  realRows?: Array<{ account: string; quantity: number }>
}) {
  const { netWorth, envelopes } = opts
  mockHledgerExecText.mockResolvedValue(
    'assets:checking\nassets:savings\nassets:checking:budget:unallocated\n',
  )
  mockHledgerExec.mockResolvedValue({}) // both reads — transform is stubbed below
  const realRows = opts.realRows ?? [{ account: 'assets:checking', quantity: netWorth }]
  mockTransformBalanceReport
    // cumulative budget balances: one envelope holding `envelopes`, unallocated 0
    .mockReturnValueOnce({
      rows: [
        { account: 'assets:checking:budget:food', amounts: [{ commodity: '$', quantity: envelopes }] },
        { account: 'assets:checking:budget:unallocated', amounts: [{ commodity: '$', quantity: 0 }] },
      ],
      totals: [{ commodity: '$', quantity: envelopes }],
    })
    // net worth across all real accounts
    .mockReturnValueOnce({
      rows: realRows.map(r => ({ account: r.account, amounts: [{ commodity: '$', quantity: r.quantity }] })),
      totals: [{ commodity: '$', quantity: netWorth }],
    })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAppendTransaction.mockResolvedValue(undefined)
})

describe('POST /api/budget/assign — availability gate', () => {
  it('rejects an assignment whose total exceeds net worth (no journal write)', async () => {
    // Net worth $1,000, $620 already in envelopes → Ready to Assign = $380.
    stubReadyToAssign({ netWorth: 1000, envelopes: 620 })
    mockReadBody.mockResolvedValue({
      date: '2026-06-16',
      physicalAccount: 'assets:checking',
      envelopes: { 'food:dining': 500 }, // $500 > $380 available
    })

    await expect(budgetAssign(fakeEvent)).rejects.toThrow(
      "Can't assign $500.00 — only $380.00 left to assign.",
    )
    expect(mockAppendTransaction).not.toHaveBeenCalled()
    expect(mockSetResponseStatus).not.toHaveBeenCalled()
  })

  it('rejects when the SUM across multiple envelopes exceeds net worth', async () => {
    // Ready to Assign = $300; two envelopes summing to $450.
    stubReadyToAssign({ netWorth: 300, envelopes: 0 })
    mockReadBody.mockResolvedValue({
      date: '2026-06-16',
      physicalAccount: 'assets:checking',
      envelopes: { rent: 300, groceries: 150 }, // total $450 > $300
    })

    await expect(budgetAssign(fakeEvent)).rejects.toThrow(
      "Can't assign $450.00 — only $300.00 left to assign.",
    )
    expect(mockAppendTransaction).not.toHaveBeenCalled()
  })

  it('accepts an assignment within Ready to Assign', async () => {
    stubReadyToAssign({ netWorth: 1000, envelopes: 620 }) // RTA = $380
    mockReadBody.mockResolvedValue({
      date: '2026-06-16',
      physicalAccount: 'assets:checking',
      envelopes: { 'food:dining': 300 }, // $300 ≤ $380
    })

    const result = await budgetAssign(fakeEvent)

    expect(result).toEqual({ success: true })
    expect(mockAppendTransaction).toHaveBeenCalledTimes(1)
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
  })

  it('accepts an assignment exactly equal to Ready to Assign (boundary)', async () => {
    stubReadyToAssign({ netWorth: 380, envelopes: 0 }) // RTA = $380
    mockReadBody.mockResolvedValue({
      date: '2026-06-16',
      physicalAccount: 'assets:checking',
      envelopes: { vacation: 380 }, // exactly $380
    })

    const result = await budgetAssign(fakeEvent)

    expect(result).toEqual({ success: true })
    expect(mockAppendTransaction).toHaveBeenCalledTimes(1)
  })

  it('accepts savings-backed money even when checking is empty (State B, net-worth basis)', async () => {
    // Checking $0, savings $1,000 → net worth $1,000, no envelopes yet → RTA $1,000.
    stubReadyToAssign({
      netWorth: 1000,
      envelopes: 0,
      realRows: [
        { account: 'assets:checking', quantity: 0 },
        { account: 'assets:savings', quantity: 1000 },
      ],
    })
    mockReadBody.mockResolvedValue({
      date: '2026-06-16',
      physicalAccount: 'assets:checking',
      envelopes: { vacation: 500 }, // checking has $0 but savings covers it
    })

    const result = await budgetAssign(fakeEvent)

    expect(result).toEqual({ success: true })
    expect(mockAppendTransaction).toHaveBeenCalledTimes(1)
  })
})
