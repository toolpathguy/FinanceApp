import { describe, it, expect, vi, beforeEach } from 'vitest'

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
const { default: budgetTransfer } = await import('../budget/transfer.post')

const fakeEvent = {} as any

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * POST /api/budget/assign
 * Validates: Requirements 4.1, 4.2, 4.3
 */
describe('POST /api/budget/assign', () => {
  it('creates correct multi-posting transaction with balance assertion for single envelope', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-03-01',
      physicalAccount: 'assets:checking',
      envelopes: { rent: 1200 },
    })
    mockAppendTransaction.mockResolvedValue(undefined)

    const result = await budgetAssign(fakeEvent)

    expect(mockAppendTransaction).toHaveBeenCalledWith({
      date: '2025-03-01',
      status: '*',
      description: 'Budget Assignment',
      postings: [
        { account: 'assets:checking:budget:rent', amount: 1200 },
        { account: 'assets:checking:budget:unallocated', amount: -1200 },
      ],
    })
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(result).toEqual({ success: true })
  })

  it('creates correct multi-posting transaction for multiple envelopes', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-03-01',
      physicalAccount: 'assets:checking',
      envelopes: {
        rent: 1200,
        'food:groceries': 400,
        transport: 60,
      },
    })
    mockAppendTransaction.mockResolvedValue(undefined)

    const result = await budgetAssign(fakeEvent)

    expect(mockAppendTransaction).toHaveBeenCalledWith({
      date: '2025-03-01',
      status: '*',
      description: 'Budget Assignment',
      postings: [
        { account: 'assets:checking:budget:rent', amount: 1200 },
        { account: 'assets:checking:budget:food:groceries', amount: 400 },
        { account: 'assets:checking:budget:transport', amount: 60 },
        { account: 'assets:checking:budget:unallocated', amount: -1660 },
      ],
    })
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(result).toEqual({ success: true })
  })

  it('assign (unallocated → envelope) and reduce (envelope → unallocated) are exact inverses', async () => {
    // Assign $100 to entertainment.
    mockReadBody.mockResolvedValueOnce({
      date: '2025-03-01',
      physicalAccount: 'assets:checking',
      envelopes: { entertainment: 100 },
    })
    mockAppendTransaction.mockResolvedValue(undefined)
    await budgetAssign(fakeEvent)
    const assignPostings = mockAppendTransaction.mock.calls[0]![0].postings

    // Reduce $100 from entertainment (budget page uses /transfer to unallocated).
    mockReadBody.mockResolvedValueOnce({
      date: '2025-03-02',
      sourceEnvelope: 'assets:checking:budget:entertainment',
      destinationEnvelope: 'assets:checking:budget:unallocated',
      amount: 100,
    })
    await budgetTransfer(fakeEvent)
    const reducePostings = mockAppendTransaction.mock.calls[1]![0].postings

    // Net effect on each account across both transactions must be zero.
    const net = new Map<string, number>()
    for (const p of [...assignPostings, ...reducePostings]) {
      net.set(p.account, (net.get(p.account) ?? 0) + p.amount)
    }
    for (const [, amount] of net) expect(amount).toBe(0)
    // And bare checking is never touched by an assignment.
    expect(net.has('assets:checking')).toBe(false)
  })

  it('returns 400 when date is missing', async () => {
    mockReadBody.mockResolvedValue({
      physicalAccount: 'assets:checking',
      envelopes: { rent: 1200 },
    })

    await expect(budgetAssign(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('returns 400 when physicalAccount is missing', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-03-01',
      envelopes: { rent: 1200 },
    })

    await expect(budgetAssign(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('returns 400 when envelopes is empty', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-03-01',
      physicalAccount: 'assets:checking',
      envelopes: {},
    })

    await expect(budgetAssign(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('returns 400 when envelope amount is not positive', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-03-01',
      physicalAccount: 'assets:checking',
      envelopes: { rent: -100 },
    })

    await expect(budgetAssign(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  // R6.1: assign routes by the request's physicalAccount, not a fixed default.
  // A non-default base (e.g. assets:savings) must place both the envelope
  // posting and the unallocated offset under that base.
  it('routes postings under a non-default budget base', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-03-01',
      physicalAccount: 'assets:savings',
      envelopes: { vacation: 250 },
    })
    mockAppendTransaction.mockResolvedValue(undefined)

    const result = await budgetAssign(fakeEvent)

    expect(mockAppendTransaction).toHaveBeenCalledWith({
      date: '2025-03-01',
      status: '*',
      description: 'Budget Assignment',
      postings: [
        { account: 'assets:savings:budget:vacation', amount: 250 },
        { account: 'assets:savings:budget:unallocated', amount: -250 },
      ],
    })
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(result).toEqual({ success: true })
  })
})


/**
 * POST /api/budget/transfer
 * Validates: Requirements 6.1, 6.2, 6.3
 */
describe('POST /api/budget/transfer', () => {
  it('creates correct 2-posting transaction', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-03-15',
      sourceEnvelope: 'assets:checking:budget:unallocated',
      destinationEnvelope: 'assets:checking:budget:entertainment',
      amount: 20,
    })
    mockAppendTransaction.mockResolvedValue(undefined)

    const result = await budgetTransfer(fakeEvent)

    expect(mockAppendTransaction).toHaveBeenCalledWith({
      date: '2025-03-15',
      status: '*',
      description: 'Budget Transfer',
      postings: [
        { account: 'assets:checking:budget:entertainment', amount: 20 },
        { account: 'assets:checking:budget:unallocated', amount: -20 },
      ],
    })
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(result).toEqual({ success: true })
  })

  it('returns 400 when date is missing', async () => {
    mockReadBody.mockResolvedValue({
      sourceEnvelope: 'assets:checking:budget:unallocated',
      destinationEnvelope: 'assets:checking:budget:entertainment',
      amount: 20,
    })

    await expect(budgetTransfer(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('returns 400 when sourceEnvelope is missing', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-03-15',
      destinationEnvelope: 'assets:checking:budget:entertainment',
      amount: 20,
    })

    await expect(budgetTransfer(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('returns 400 when amount is not positive', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-03-15',
      sourceEnvelope: 'assets:checking:budget:unallocated',
      destinationEnvelope: 'assets:checking:budget:entertainment',
      amount: 0,
    })

    await expect(budgetTransfer(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('returns 400 when source equals destination', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-03-15',
      sourceEnvelope: 'assets:checking:budget:rent',
      destinationEnvelope: 'assets:checking:budget:rent',
      amount: 50,
    })

    await expect(budgetTransfer(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
    })
  })
})
