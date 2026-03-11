import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock Nitro globals ---

const mockHledgerExec = vi.fn()
const mockAddTransaction = vi.fn()
const mockSetResponseStatus = vi.fn()
const mockReadBody = vi.fn()
const mockGetQuery = vi.fn()

vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('readBody', mockReadBody)
vi.stubGlobal('getQuery', mockGetQuery)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  const err = new Error(opts.message) as any
  err.statusCode = opts.statusCode
  return err
})
vi.stubGlobal('setResponseStatus', mockSetResponseStatus)
vi.stubGlobal('hledgerExec', mockHledgerExec)
vi.stubGlobal('addTransaction', mockAddTransaction)

// Import handlers after globals are stubbed
const { default: postTransactions } = await import('../transactions.post')
const { default: getBalances } = await import('../balances.get')
const { default: getTransactions } = await import('../transactions.get')
const { default: getAccounts } = await import('../accounts.get')

const fakeEvent = {} as any

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * POST /api/transactions — validation logic
 * Validates: Requirements 6.1, 6.2
 */
describe('POST /api/transactions', () => {
  it('returns 400 when date is missing', async () => {
    mockReadBody.mockResolvedValue({
      description: 'Groceries',
      postings: [
        { account: 'expenses:food', amount: 50, commodity: '$' },
        { account: 'assets:checking' },
      ],
    })

    await expect(postTransactions(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Missing required fields',
    })
  })

  it('returns 400 when description is missing', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-01-15',
      postings: [
        { account: 'expenses:food', amount: 50, commodity: '$' },
        { account: 'assets:checking' },
      ],
    })

    await expect(postTransactions(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Missing required fields',
    })
  })

  it('returns 400 when postings is missing', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-01-15',
      description: 'Groceries',
    })

    await expect(postTransactions(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Missing required fields',
    })
  })

  it('returns 400 when postings is empty', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-01-15',
      description: 'Groceries',
      postings: [],
    })

    await expect(postTransactions(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Missing required fields',
    })
  })

  it('returns 400 when fewer than 2 postings', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-01-15',
      description: 'Groceries',
      postings: [{ account: 'expenses:food', amount: 50, commodity: '$' }],
    })

    await expect(postTransactions(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
      message: 'At least 2 postings required',
    })
  })

  it('calls addTransaction and returns 201 for valid input', async () => {
    const validBody = {
      date: '2025-01-15',
      description: 'Groceries',
      postings: [
        { account: 'expenses:food', amount: 50, commodity: '$' },
        { account: 'assets:checking' },
      ],
    }
    mockReadBody.mockResolvedValue(validBody)
    mockAddTransaction.mockResolvedValue(undefined)

    const result = await postTransactions(fakeEvent)

    expect(mockAddTransaction).toHaveBeenCalledWith(validBody)
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(result).toEqual({ success: true })
  })
})


/**
 * GET /api/balances — query param forwarding
 * Validates: Requirements 4.2, 4.3, 4.4
 */
describe('GET /api/balances', () => {
  it('passes period as -p flag to hledger', async () => {
    mockGetQuery.mockReturnValue({ period: 'monthly' })
    mockHledgerExec.mockResolvedValue([])

    await getBalances(fakeEvent)

    expect(mockHledgerExec).toHaveBeenCalledWith(['bal', '-p', 'monthly'])
  })

  it('passes account as positional argument to hledger', async () => {
    mockGetQuery.mockReturnValue({ account: 'expenses:food' })
    mockHledgerExec.mockResolvedValue([])

    await getBalances(fakeEvent)

    expect(mockHledgerExec).toHaveBeenCalledWith(['bal', 'expenses:food'])
  })

  it('passes depth as --depth flag to hledger', async () => {
    mockGetQuery.mockReturnValue({ depth: '2' })
    mockHledgerExec.mockResolvedValue([])

    await getBalances(fakeEvent)

    expect(mockHledgerExec).toHaveBeenCalledWith(['bal', '--depth', '2'])
  })

  it('passes all query params together', async () => {
    mockGetQuery.mockReturnValue({ period: 'weekly', account: 'assets', depth: '3' })
    mockHledgerExec.mockResolvedValue([])

    await getBalances(fakeEvent)

    expect(mockHledgerExec).toHaveBeenCalledWith(['bal', '-p', 'weekly', 'assets', '--depth', '3'])
  })

  it('calls hledger with only bal when no query params', async () => {
    mockGetQuery.mockReturnValue({})
    mockHledgerExec.mockResolvedValue([])

    await getBalances(fakeEvent)

    expect(mockHledgerExec).toHaveBeenCalledWith(['bal'])
  })
})

/**
 * GET /api/transactions — query param forwarding
 * Validates: Requirements 5.2, 5.3, 5.4
 */
describe('GET /api/transactions', () => {
  it('passes startDate as -b flag to hledger', async () => {
    mockGetQuery.mockReturnValue({ startDate: '2025-01-01' })
    mockHledgerExec.mockResolvedValue([])

    await getTransactions(fakeEvent)

    expect(mockHledgerExec).toHaveBeenCalledWith(['print', '-b', '2025-01-01'])
  })

  it('passes endDate as -e flag to hledger', async () => {
    mockGetQuery.mockReturnValue({ endDate: '2025-12-31' })
    mockHledgerExec.mockResolvedValue([])

    await getTransactions(fakeEvent)

    expect(mockHledgerExec).toHaveBeenCalledWith(['print', '-e', '2025-12-31'])
  })

  it('passes account as positional argument to hledger', async () => {
    mockGetQuery.mockReturnValue({ account: 'expenses' })
    mockHledgerExec.mockResolvedValue([])

    await getTransactions(fakeEvent)

    expect(mockHledgerExec).toHaveBeenCalledWith(['print', 'expenses'])
  })

  it('passes all query params together', async () => {
    mockGetQuery.mockReturnValue({ startDate: '2025-01-01', endDate: '2025-06-30', account: 'assets:bank' })
    mockHledgerExec.mockResolvedValue([])

    await getTransactions(fakeEvent)

    expect(mockHledgerExec).toHaveBeenCalledWith(['print', '-b', '2025-01-01', '-e', '2025-06-30', 'assets:bank'])
  })

  it('calls hledger with only print when no query params', async () => {
    mockGetQuery.mockReturnValue({})
    mockHledgerExec.mockResolvedValue([])

    await getTransactions(fakeEvent)

    expect(mockHledgerExec).toHaveBeenCalledWith(['print'])
  })
})

/**
 * GET /api/accounts
 * Validates: Requirement 7.1
 */
describe('GET /api/accounts', () => {
  it('calls hledger with accounts command', async () => {
    mockHledgerExec.mockResolvedValue(['expenses:food', 'assets:checking'])

    const result = await getAccounts()

    expect(mockHledgerExec).toHaveBeenCalledWith(['accounts'])
    expect(result).toEqual(['expenses:food', 'assets:checking'])
  })
})
