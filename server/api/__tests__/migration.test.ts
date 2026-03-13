import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFile, readFile as fsReadFile, mkdir, rm, appendFile } from 'node:fs/promises'
import { join } from 'node:path'

// --- Mock Nitro globals ---

const mockAppendTransaction = vi.fn()
const mockHledgerExec = vi.fn()
const mockHledgerExecText = vi.fn()
const mockTransformBalanceReport = vi.fn()
const mockGetQuery = vi.fn()
const mockReadBody = vi.fn()
const mockSetResponseStatus = vi.fn()

vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('getQuery', mockGetQuery)
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

vi.mock('node:fs', () => ({ existsSync: () => false }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal() as any
  return {
    ...actual,
    // Override readFile with a mock that delegates to the real one by default
    // (the budget.get handler uses readFile for hidden-envelopes.json which we don't need)
    readFile: vi.fn((...args: any[]) => actual.readFile(...args)),
  }
})
vi.mock('../../utils/journalWriter', async (importOriginal) => {
  const actual = await importOriginal() as any
  return {
    ...actual,
    appendTransaction: (...args: any[]) => mockAppendTransaction(...args),
  }
})

const { default: getBudget } = await import('../budget.get')
const { default: budgetAssign } = await import('../budget/assign.post')

const fakeEvent = {} as any

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * Migration Compatibility — Integration Tests
 * Validates: Requirements 13.1, 13.2, 13.3
 */
describe('Migration: journal with no budget sub-accounts', () => {
  it('budget page shows $0 for all assigned and available amounts', async () => {
    mockGetQuery.mockReturnValue({})

    // Journal has expense accounts but NO budget sub-accounts
    mockHledgerExecText.mockResolvedValue(
      'expenses:food:groceries\nexpenses:housing:rent\n',
    )

    // Expense activity exists
    const expenseRaw = {}
    mockHledgerExec
      .mockResolvedValueOnce(expenseRaw)
      // Budget sub-account query throws — no budget accounts exist yet
      .mockRejectedValueOnce(new Error('No matching accounts'))

    mockTransformBalanceReport.mockReturnValueOnce({
      rows: [
        { account: 'expenses:food:groceries', amounts: [{ commodity: '$', quantity: 75 }] },
        { account: 'expenses:housing:rent', amounts: [{ commodity: '$', quantity: 1000 }] },
      ],
      totals: [{ commodity: '$', quantity: 1075 }],
    })

    const result = await getBudget(fakeEvent)

    // Ready to Assign should be 0 — no unallocated account exists
    expect(result.readyToAssign).toBe(0)

    // All categories should have available=0
    for (const group of result.categoryGroups) {
      for (const cat of group.categories) {
        expect(cat.available).toBe(0)
      }
    }
  })
})

describe('Migration: first assignment creates budget sub-accounts', () => {
  it('POST /api/budget/assign calls appendTransaction with correct budget sub-account postings', async () => {
    mockReadBody.mockResolvedValue({
      date: '2025-04-01',
      physicalAccount: 'assets:checking',
      envelopes: { 'food:groceries': 300, rent: 1200 },
    })
    mockAppendTransaction.mockResolvedValue(undefined)

    const result = await budgetAssign(fakeEvent)

    // The assignment transaction creates budget sub-accounts by writing postings to them
    // hledger creates accounts on first use — no separate account creation needed
    expect(mockAppendTransaction).toHaveBeenCalledTimes(1)
    const txInput = mockAppendTransaction.mock.calls[0][0]

    // Verify budget sub-account postings are present
    expect(txInput.postings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: 'assets:checking:budget:food:groceries', amount: 300 }),
        expect.objectContaining({ account: 'assets:checking:budget:rent', amount: 1200 }),
      ]),
    )

    // Verify physical account debit (no balance assertion for partial assignments)
    const physicalPosting = txInput.postings.find((p: any) => p.account === 'assets:checking')
    expect(physicalPosting).toBeDefined()
    expect(physicalPosting.amount).toBe(-1500)
    expect(physicalPosting.balanceAssertion).toBeUndefined()

    // Verify transaction metadata
    expect(txInput.status).toBe('*')
    expect(txInput.description).toBe('Budget Assignment')

    expect(mockSetResponseStatus).toHaveBeenCalledWith(fakeEvent, 201)
    expect(result).toEqual({ success: true })
  })
})

// Import the REAL journalWriter functions (bypasses the mock for this describe block)
// We use formatTransaction + direct fs to avoid the mock on appendTransaction
const { formatTransaction, validateTransaction } = await import('../../utils/journalWriter')

describe('Migration: existing transactions preserved after enabling envelope budgeting', () => {
  const testDir = join(process.cwd(), 'test-data', '__migration-test__')
  const testJournal = join(testDir, 'migration.journal')

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true })
    vi.stubEnv('LEDGER_FILE', testJournal)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(testDir, { recursive: true, force: true })
  })

  it('appending a budget assignment preserves all existing journal content', async () => {
    const existingContent = [
      '2025-01-01 * Opening Balance',
      '    assets:checking  $5000.00',
      '    equity:opening',
      '',
      '2025-01-15 * Grocery Store',
      '    expenses:food:groceries  $110.00',
      '    assets:checking',
      '',
      '2025-02-01 * Salary',
      '    assets:checking  $3500.00',
      '    income:salary',
      '',
    ].join('\n')

    await writeFile(testJournal, existingContent, 'utf-8')

    // Use the real formatTransaction to produce valid hledger output,
    // then append directly to the file (bypasses the mocked appendTransaction)
    const budgetTx = {
      date: '2025-03-01',
      status: '*' as const,
      description: 'Budget Assignment',
      postings: [
        { account: 'assets:checking:budget:food:groceries', amount: 400 },
        { account: 'assets:checking:budget:housing:rent', amount: 1200 },
        { account: 'assets:checking:budget:unallocated', amount: 1890 },
        { account: 'assets:checking', amount: -3490, balanceAssertion: 0 },
      ],
    }

    // Validate first, then format and append
    const errors = validateTransaction(budgetTx)
    expect(errors).toEqual([])

    const formatted = formatTransaction(budgetTx)
    await appendFile(testJournal, formatted, 'utf-8')

    const finalContent = await fsReadFile(testJournal, 'utf-8')

    // All original transactions must still be present and unmodified
    expect(finalContent).toContain('2025-01-01 * Opening Balance')
    expect(finalContent).toContain('    assets:checking  $5000.00')
    expect(finalContent).toContain('    equity:opening')

    expect(finalContent).toContain('2025-01-15 * Grocery Store')
    expect(finalContent).toContain('    expenses:food:groceries  $110.00')

    expect(finalContent).toContain('2025-02-01 * Salary')
    expect(finalContent).toContain('    assets:checking  $3500.00')
    expect(finalContent).toContain('    income:salary')

    // The new budget assignment should also be present
    expect(finalContent).toContain('2025-03-01 * Budget Assignment')
    expect(finalContent).toContain('assets:checking:budget:food:groceries')

    // Original content appears before the new transaction
    expect(finalContent.indexOf('Opening Balance')).toBeLessThan(
      finalContent.indexOf('Budget Assignment'),
    )

    // Verify the existing content prefix is byte-for-byte identical
    expect(finalContent.startsWith(existingContent)).toBe(true)
  })
})
