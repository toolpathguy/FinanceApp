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
        { account: 'assets:checking', amount: -1200 },
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
        { account: 'assets:checking', amount: -1660 },
      ],
    })
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(result).toEqual({ success: true })
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
