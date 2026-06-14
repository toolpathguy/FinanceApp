import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock Nitro globals ---

const mockHledgerExec = vi.fn()
const mockAddTransaction = vi.fn()
const mockAppendTransaction = vi.fn()
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

// Mock the journalWriter module so appendTransaction is intercepted
vi.mock('../../utils/journalWriter', () => ({
  appendTransaction: (...args: any[]) => mockAppendTransaction(...args),
}))

const mockHledgerExecText = vi.fn()
vi.stubGlobal('hledgerExecText', mockHledgerExecText)

// Budget base derivation (Issue #4 item 3). Defaults to assets:checking;
// individual tests can override with mockResolvedValueOnce.
const mockResolveBudgetBase = vi.fn().mockResolvedValue('assets:checking')
vi.stubGlobal('resolveBudgetBase', mockResolveBudgetBase)

const mockTransformTransactions = vi.fn((raw: any[]) => raw)
const mockTransformBalanceReport = vi.fn((raw: any) => raw)
vi.stubGlobal('transformTransactions', mockTransformTransactions)
vi.stubGlobal('transformBalanceReport', mockTransformBalanceReport)

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

  it('returns 400 when legacy body has no description and no postings array', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-01-15',
      postings: [
        { account: 'expenses:food', amount: 50, commodity: '$' },
        { account: 'assets:checking' },
      ],
    })

    // No description + no payee/type → unrecognized format
    await expect(postTransactions(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Unrecognized transaction format',
    })
  })

  it('returns 400 when legacy body has description but no postings', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-01-15',
      description: 'Groceries',
    })

    // description present but postings not an array → unrecognized format
    await expect(postTransactions(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Unrecognized transaction format',
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

  it('calls appendTransaction and returns 201 for valid legacy input', async () => {
    const validBody = {
      date: '2025-01-15',
      description: 'Groceries',
      postings: [
        { account: 'expenses:food', amount: 50, commodity: '$' },
        { account: 'assets:checking' },
      ],
    }
    mockReadBody.mockResolvedValue(validBody)
    mockAppendTransaction.mockResolvedValue(undefined)

    const result = await postTransactions(fakeEvent)

    expect(mockAppendTransaction).toHaveBeenCalledWith(validBody)
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(result).toEqual({ success: true })
  })

  it('converts SimplifiedTransactionInput expense with envelope category to budget sub-account', async () => {
    const simplifiedBody = {
      date: '2025-01-15',
      payee: 'Coffee Shop',
      account: 'assets:checking',
      type: 'expense',
      category: 'expenses:dining',
      amount: 5,
    }
    mockReadBody.mockResolvedValue(simplifiedBody)
    mockAppendTransaction.mockResolvedValue(undefined)

    const result = await postTransactions(fakeEvent)

    expect(mockAppendTransaction).toHaveBeenCalledWith({
      date: '2025-01-15',
      description: 'Coffee Shop',
      postings: [
        { account: 'expenses:dining', amount: 5, commodity: '$' },
        { account: 'assets:checking:budget:dining', amount: -5, commodity: '$' },
      ],
      status: '*',
    })
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(result).toEqual({ success: true })
  })

  it('generates 4-posting structure for credit card expense with envelope category', async () => {
    const simplifiedBody = {
      date: '2025-03-15',
      payee: 'Restaurant',
      account: 'liabilities:credit-card',
      type: 'expense',
      category: 'expenses:food:restaurants',
      amount: 45,
    }
    mockReadBody.mockResolvedValue(simplifiedBody)
    mockAppendTransaction.mockResolvedValue(undefined)

    const result = await postTransactions(fakeEvent)

    expect(mockAppendTransaction).toHaveBeenCalledWith({
      date: '2025-03-15',
      description: 'Restaurant',
      postings: [
        { account: 'expenses:food:restaurants', amount: 45, commodity: '$' },
        { account: 'assets:checking:budget:food:restaurants', amount: -45, commodity: '$' },
        { account: 'assets:checking:budget:pending:credit-card', amount: 45, commodity: '$' },
        { account: 'liabilities:credit-card', amount: -45, commodity: '$' },
      ],
      status: '*',
    })
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(result).toEqual({ success: true })
  })

  it('routes credit-card envelope postings to the derived (non-default) budget base', async () => {
    // Issue #4 item 3: budget base comes from resolveBudgetBase, not a literal.
    mockResolveBudgetBase.mockResolvedValueOnce('assets:bank:everyday')
    const simplifiedBody = {
      date: '2025-03-15',
      payee: 'Restaurant',
      account: 'liabilities:credit-card',
      type: 'expense',
      category: 'expenses:food:restaurants',
      amount: 45,
    }
    mockReadBody.mockResolvedValue(simplifiedBody)
    mockAppendTransaction.mockResolvedValue(undefined)

    await postTransactions(fakeEvent)

    expect(mockAppendTransaction).toHaveBeenCalledWith({
      date: '2025-03-15',
      description: 'Restaurant',
      postings: [
        { account: 'expenses:food:restaurants', amount: 45, commodity: '$' },
        { account: 'assets:bank:everyday:budget:food:restaurants', amount: -45, commodity: '$' },
        { account: 'assets:bank:everyday:budget:pending:credit-card', amount: 45, commodity: '$' },
        { account: 'liabilities:credit-card', amount: -45, commodity: '$' },
      ],
      status: '*',
    })
  })

  it('does not apply envelope postings for expense without category', async () => {
    const simplifiedBody = {
      date: '2025-01-15',
      payee: 'ATM Withdrawal',
      account: 'assets:checking',
      type: 'expense',
      amount: 100,
      // no category — no envelope mapping
    }
    mockReadBody.mockResolvedValue(simplifiedBody)
    mockAppendTransaction.mockResolvedValue(undefined)

    const result = await postTransactions(fakeEvent)

    // Without a category, toTransactionInput uses category as undefined
    // and applyEnvelopePostings returns the original txInput unchanged
    expect(mockAppendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2025-01-15',
        description: 'ATM Withdrawal',
      }),
    )
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(result).toEqual({ success: true })
  })

  it('converts SimplifiedTransactionInput and returns 201 for valid transfer', async () => {
    const simplifiedBody = {
      date: '2025-02-01',
      payee: 'Transfer',
      account: 'assets:checking',
      type: 'transfer',
      transferAccount: 'assets:savings',
      amount: 500,
    }
    mockReadBody.mockResolvedValue(simplifiedBody)
    mockAppendTransaction.mockResolvedValue(undefined)

    const result = await postTransactions(fakeEvent)

    expect(mockAppendTransaction).toHaveBeenCalledWith({
      date: '2025-02-01',
      description: 'Transfer',
      postings: [
        { account: 'assets:savings', amount: 500, commodity: '$' },
        { account: 'assets:checking', amount: -500, commodity: '$' },
      ],
      status: '*',
    })
    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(result).toEqual({ success: true })
  })

  it('returns 400 for simplified input missing required fields', async () => {
    mockReadBody.mockResolvedValue({
      payee: 'Coffee Shop',
      type: 'expense',
      // missing date, account, amount
    })

    await expect(postTransactions(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Missing required fields',
    })
  })

  it('returns 400 for unrecognized body format', async () => {
    mockReadBody.mockResolvedValue({ foo: 'bar' })

    await expect(postTransactions(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Unrecognized transaction format',
    })
  })

  // Issue #4 item 2: amount must be a positive finite number.
  const simplifiedWith = (amount: unknown) => ({
    date: '2025-01-15',
    payee: 'Coffee Shop',
    account: 'assets:checking',
    type: 'expense',
    category: 'expenses:dining',
    amount,
  })

  it.each([
    ['a negative amount', -5],
    ['a zero amount', 0],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a non-numeric amount', '50' as unknown],
  ])('returns 400 for %s', async (_label, amount) => {
    mockReadBody.mockResolvedValue(simplifiedWith(amount))

    await expect(postTransactions(fakeEvent)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Amount must be a positive number',
    })
    expect(mockAppendTransaction).not.toHaveBeenCalled()
  })

  it('accepts a positive amount and returns 201', async () => {
    mockReadBody.mockResolvedValue(simplifiedWith(5))
    mockAppendTransaction.mockResolvedValue(undefined)

    const result = await postTransactions(fakeEvent)

    expect(mockAppendTransaction).toHaveBeenCalled()
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

  it('passes account as a query term after a -- separator to hledger', async () => {
    // Issue #2, R4.3: account goes after `--` so it can't be read as a flag.
    mockGetQuery.mockReturnValue({ account: 'expenses' })
    mockHledgerExec.mockResolvedValue([])

    await getTransactions(fakeEvent)

    expect(mockHledgerExec).toHaveBeenCalledWith(['print', '--', 'expenses'])
  })

  it('passes all query params together', async () => {
    mockGetQuery.mockReturnValue({ startDate: '2025-01-01', endDate: '2025-06-30', account: 'assets:bank' })
    mockHledgerExec.mockResolvedValue([])

    await getTransactions(fakeEvent)

    expect(mockHledgerExec).toHaveBeenCalledWith(['print', '-b', '2025-01-01', '-e', '2025-06-30', '--', 'assets:bank'])
  })

  it('calls hledger with only print when no query params', async () => {
    mockGetQuery.mockReturnValue({})
    mockHledgerExec.mockResolvedValue([])

    await getTransactions(fakeEvent)

    expect(mockHledgerExec).toHaveBeenCalledWith(['print'])
  })

  // Issue #4 item 4: a date-filtered register seeds the opening balance.
  it('seeds the running balance from a bal -e <startDate> query for a filtered account', async () => {
    mockGetQuery.mockReturnValue({ startDate: '2025-02-01', account: 'assets:checking' })
    mockHledgerExec
      .mockResolvedValueOnce([
        {
          date: '2025-02-10',
          description: 'Coffee',
          status: '*',
          index: 1,
          postings: [
            { account: 'assets:checking', amounts: [{ commodity: '$', quantity: -5 }] },
            { account: 'expenses:dining', amounts: [{ commodity: '$', quantity: 5 }] },
          ],
        },
      ]) // print
      .mockResolvedValueOnce({ totals: [{ commodity: '$', quantity: 1000 }] }) // bal seed

    const rows = await getTransactions(fakeEvent)

    // The opening-balance query is issued with exclusive end = startDate.
    expect(mockHledgerExec).toHaveBeenCalledWith(['bal', '-e', '2025-02-01', '--', 'assets:checking'])
    // First row balance = $1000 opening − $5 = $995, not −$5.
    expect(rows[0].runningBalance).toBe(995)
  })

  it('does not issue a seed query when no startDate is supplied', async () => {
    mockGetQuery.mockReturnValue({ account: 'assets:checking' })
    mockHledgerExec.mockResolvedValue([])

    await getTransactions(fakeEvent)

    expect(mockHledgerExec).toHaveBeenCalledTimes(1)
    expect(mockHledgerExec).toHaveBeenCalledWith(['print', '--', 'assets:checking'])
  })
})

/**
 * GET /api/accounts
 * Validates: Requirements 6.1, 6.2, 6.5
 */
describe('GET /api/accounts', () => {
  const accountsOutput = 'assets:checking\nassets:savings\nexpenses:food\nexpenses:dining\nincome:salary\nliabilities:credit-card\n'

  it('returns all accounts when no type param is provided', async () => {
    mockGetQuery.mockReturnValue({})
    mockHledgerExecText.mockResolvedValue(accountsOutput)

    const result = await getAccounts(fakeEvent)

    expect(mockHledgerExecText).toHaveBeenCalledWith(['accounts'])
    expect(result).toEqual([
      'assets:checking', 'assets:savings', 'expenses:food',
      'expenses:dining', 'income:salary', 'liabilities:credit-card',
    ])
  })

  it('returns all accounts when type=all', async () => {
    mockGetQuery.mockReturnValue({ type: 'all' })
    mockHledgerExecText.mockResolvedValue(accountsOutput)

    const result = await getAccounts(fakeEvent)

    expect(result).toEqual([
      'assets:checking', 'assets:savings', 'expenses:food',
      'expenses:dining', 'income:salary', 'liabilities:credit-card',
    ])
  })

  it('returns only real accounts when type=real', async () => {
    mockGetQuery.mockReturnValue({ type: 'real' })
    mockHledgerExecText.mockResolvedValue(accountsOutput)

    const result = await getAccounts(fakeEvent)

    expect(result).toEqual(['assets:checking', 'assets:savings', 'liabilities:credit-card'])
  })

  it('returns only category accounts when type=category', async () => {
    mockGetQuery.mockReturnValue({ type: 'category' })
    mockHledgerExecText.mockResolvedValue(accountsOutput)

    const result = await getAccounts(fakeEvent)

    expect(result).toEqual(['expenses:food', 'expenses:dining', 'income:salary'])
  })
})
