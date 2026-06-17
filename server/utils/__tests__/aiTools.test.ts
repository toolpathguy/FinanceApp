import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetBudgetReport = vi.fn()
const mockGetTransactionList = vi.fn()

vi.mock('../budgetReport', () => ({ getBudgetReport: (...a: any[]) => mockGetBudgetReport(...a) }))
vi.mock('../transactionList', () => ({ getTransactionList: (...a: any[]) => mockGetTransactionList(...a) }))

// resolveBudgetBase is auto-imported in aiTools.ts.
vi.stubGlobal('resolveBudgetBase', async () => 'assets:checking')

const {
  TOOLS,
  READ_TOOL_HANDLERS,
  isProposedActionTool,
  toProposedAction,
  READ_TOOL_NAMES,
  PROPOSED_ACTION_TOOL_NAMES,
} = await import('../aiTools')

beforeEach(() => vi.clearAllMocks())

describe('tool classification', () => {
  it('flags assign/transfer as proposed actions and reads as reads', () => {
    expect(isProposedActionTool('assign_to_envelope')).toBe(true)
    expect(isProposedActionTool('transfer_between_envelopes')).toBe(true)
    expect(isProposedActionTool('get_budget')).toBe(false)
    expect(isProposedActionTool('get_transactions')).toBe(false)
  })

  it('exposes all four tools with the cache breakpoint on the last definition', () => {
    const names = TOOLS.map(t => t.name)
    expect(names).toEqual([...READ_TOOL_NAMES, ...PROPOSED_ACTION_TOOL_NAMES])
    expect(TOOLS[TOOLS.length - 1]!.cache_control).toEqual({ type: 'ephemeral' })
    // Only the last one carries a breakpoint (cache-stable prefix).
    expect(TOOLS.slice(0, -1).every(t => t.cache_control == null)).toBe(true)
  })
})

describe('read tool handlers delegate to server/utils', () => {
  it('get_budget → getBudgetReport with the period', async () => {
    mockGetBudgetReport.mockResolvedValue({ readyToAssign: 100 })
    const result = await READ_TOOL_HANDLERS.get_budget!({ period: '2025-03' })
    expect(mockGetBudgetReport).toHaveBeenCalledWith('2025-03')
    expect(result).toEqual({ readyToAssign: 100 })
  })

  it('get_budget → empty period when omitted', async () => {
    mockGetBudgetReport.mockResolvedValue({})
    await READ_TOOL_HANDLERS.get_budget!({})
    expect(mockGetBudgetReport).toHaveBeenCalledWith('')
  })

  it('get_transactions → getTransactionList with the query', async () => {
    mockGetTransactionList.mockResolvedValue([])
    await READ_TOOL_HANDLERS.get_transactions!({ account: 'expenses:rent', limit: 10 })
    expect(mockGetTransactionList).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'expenses:rent', limit: 10 }),
    )
  })
})

describe('toProposedAction (never writes — builds a proposal)', () => {
  it('builds an assign proposal, resolving the budget host and normalizing keys', async () => {
    const action = await toProposedAction({
      id: 'toolu_1',
      name: 'assign_to_envelope',
      input: { envelopes: { 'expenses:rent': 1200, 'food:groceries': 400 } },
    })
    expect(action.kind).toBe('assign')
    expect(action.id).toBe('toolu_1')
    if (action.kind !== 'assign') throw new Error('expected assign')
    // "expenses:" prefix stripped to the budget sub-account key.
    expect(action.payload.envelopes).toEqual({ rent: 1200, 'food:groceries': 400 })
    expect(action.payload.physicalAccount).toBe('assets:checking')
    expect(action.summary).toContain('1200')
  })

  it('builds a transfer proposal with full envelope account paths', async () => {
    const action = await toProposedAction({
      id: 'toolu_2',
      name: 'transfer_between_envelopes',
      input: { sourceEnvelope: 'dining', destinationEnvelope: 'food:groceries', amount: 50 },
    })
    expect(action.kind).toBe('transfer')
    if (action.kind !== 'transfer') throw new Error('expected transfer')
    expect(action.payload.sourceEnvelope).toBe('assets:checking:budget:dining')
    expect(action.payload.destinationEnvelope).toBe('assets:checking:budget:food:groceries')
    expect(action.payload.amount).toBe(50)
  })
})
