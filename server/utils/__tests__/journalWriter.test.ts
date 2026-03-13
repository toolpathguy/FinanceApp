import { describe, it, expect } from 'vitest'
import { validateTransaction, formatTransaction } from '../journalWriter'
import type { TransactionInput } from '../../../types/api'

// --- validateTransaction() tests ---

describe('validateTransaction()', () => {
  const validInput: TransactionInput = {
    date: '2025-01-15',
    description: 'Coffee Shop',
    postings: [
      { account: 'expenses:dining', amount: 5.00 },
      { account: 'assets:checking', amount: -5.00 },
    ],
  }

  it('returns empty array for a valid 2-posting transaction', () => {
    expect(validateTransaction(validInput)).toEqual([])
  })

  it('returns error for invalid date format (slash-separated)', () => {
    const errors = validateTransaction({ ...validInput, date: '2025/01/15' })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/date/i)
  })

  it('returns error for invalid date format (not-a-date)', () => {
    const errors = validateTransaction({ ...validInput, date: 'not-a-date' })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/date/i)
  })

  it('returns error for invalid calendar date (2025-02-30)', () => {
    const errors = validateTransaction({ ...validInput, date: '2025-02-30' })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/date/i)
  })

  it('returns error for empty description', () => {
    const errors = validateTransaction({ ...validInput, description: '' })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/description/i)
  })

  it('returns error for whitespace-only description', () => {
    const errors = validateTransaction({ ...validInput, description: '   ' })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/description/i)
  })

  it('returns error for fewer than 2 postings', () => {
    const errors = validateTransaction({
      ...validInput,
      postings: [{ account: 'expenses:dining', amount: 5.00 }],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/2 postings/i)
  })

  it('returns error for empty account name in a posting', () => {
    const errors = validateTransaction({
      ...validInput,
      postings: [
        { account: '', amount: 5.00 },
        { account: 'assets:checking', amount: -5.00 },
      ],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.match(/account/i))).toBe(true)
  })

  it('returns error when explicit amounts do not sum to zero', () => {
    const errors = validateTransaction({
      ...validInput,
      postings: [
        { account: 'expenses:dining', amount: 5.00 },
        { account: 'assets:checking', amount: -3.00 },
      ],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.match(/sum to zero/i))).toBe(true)
  })

  it('returns error when more than one posting omits the amount', () => {
    const errors = validateTransaction({
      ...validInput,
      postings: [
        { account: 'expenses:dining' },
        { account: 'assets:checking' },
      ],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.match(/omit/i))).toBe(true)
  })

  it('returns empty array when exactly one posting omits the amount', () => {
    const errors = validateTransaction({
      ...validInput,
      postings: [
        { account: 'expenses:dining', amount: 5.00 },
        { account: 'assets:checking' },
      ],
    })
    expect(errors).toEqual([])
  })

  it('returns empty array for a valid transaction with status marker *', () => {
    const errors = validateTransaction({ ...validInput, status: '*' })
    expect(errors).toEqual([])
  })

  it('returns empty array for a valid transaction with status marker !', () => {
    const errors = validateTransaction({ ...validInput, status: '!' })
    expect(errors).toEqual([])
  })
})

// --- formatTransaction() tests ---

describe('formatTransaction()', () => {
  it('formats a simple 2-posting expense transaction correctly', () => {
    const input: TransactionInput = {
      date: '2025-01-15',
      description: 'Coffee Shop',
      postings: [
        { account: 'expenses:dining', amount: 5.00 },
        { account: 'assets:checking', amount: -5.00 },
      ],
    }
    const output = formatTransaction(input)
    expect(output).toContain('2025-01-15 Coffee Shop')
    expect(output).toContain('    expenses:dining  $5.00')
    expect(output).toContain('    assets:checking  $-5.00')
  })

  it('formats a 4-posting credit card transaction', () => {
    const input: TransactionInput = {
      date: '2025-03-15',
      status: '*',
      description: 'Restaurant',
      postings: [
        { account: 'expenses:food:restaurants', amount: 45.00 },
        { account: 'assets:checking:budget:food:restaurants', amount: -45.00 },
        { account: 'assets:checking:budget:pending:credit-card', amount: 45.00 },
        { account: 'liabilities:credit-card', amount: -45.00 },
      ],
    }
    const output = formatTransaction(input)
    expect(output).toContain('2025-03-15 * Restaurant')
    expect(output).toContain('    expenses:food:restaurants  $45.00')
    expect(output).toContain('    assets:checking:budget:food:restaurants  $-45.00')
    expect(output).toContain('    assets:checking:budget:pending:credit-card  $45.00')
    expect(output).toContain('    liabilities:credit-card  $-45.00')
  })

  it('formats a 5+ posting budget assignment transaction', () => {
    const input: TransactionInput = {
      date: '2025-03-01',
      status: '*',
      description: 'Budget Assignment',
      postings: [
        { account: 'assets:checking:budget:rent', amount: 1200.00 },
        { account: 'assets:checking:budget:groceries', amount: 400.00 },
        { account: 'assets:checking:budget:transport', amount: 60.00 },
        { account: 'assets:checking:budget:entertainment', amount: 50.00 },
        { account: 'assets:checking:budget:unallocated', amount: 1790.00 },
        { account: 'assets:checking', amount: -3500.00, balanceAssertion: 0 },
      ],
    }
    const output = formatTransaction(input)
    expect(output).toContain('2025-03-01 * Budget Assignment')
    expect(output).toContain('    assets:checking:budget:rent  $1200.00')
    expect(output).toContain('    assets:checking:budget:groceries  $400.00')
    expect(output).toContain('    assets:checking:budget:transport  $60.00')
    expect(output).toContain('    assets:checking:budget:entertainment  $50.00')
    expect(output).toContain('    assets:checking:budget:unallocated  $1790.00')
    expect(output).toContain('    assets:checking  $-3500.00  = $0.00')
  })

  it('includes balance assertion syntax when balanceAssertion is set', () => {
    const input: TransactionInput = {
      date: '2025-03-01',
      description: 'Budget Assignment',
      postings: [
        { account: 'assets:checking:budget:groceries', amount: 400.00 },
        { account: 'assets:checking', amount: -400.00, balanceAssertion: 0 },
      ],
    }
    const output = formatTransaction(input)
    expect(output).toContain('= $0.00')
  })

  it('omits amount for postings with undefined amount', () => {
    const input: TransactionInput = {
      date: '2025-03-03',
      description: 'Grocery Store',
      postings: [
        { account: 'expenses:food:groceries', amount: 110.00 },
        { account: 'assets:checking:budget:groceries' },
      ],
    }
    const output = formatTransaction(input)
    const lines = output.split('\n')
    const lastPostingLine = lines.find(l => l.includes('assets:checking:budget:groceries'))!
    expect(lastPostingLine).toBe('    assets:checking:budget:groceries')
  })

  it('prepends \\n and ends with \\n', () => {
    const input: TransactionInput = {
      date: '2025-01-15',
      description: 'Test',
      postings: [
        { account: 'expenses:dining', amount: 5.00 },
        { account: 'assets:checking', amount: -5.00 },
      ],
    }
    const output = formatTransaction(input)
    expect(output.startsWith('\n')).toBe(true)
    expect(output.endsWith('\n')).toBe(true)
  })

  it('uses 4-space indent for posting lines', () => {
    const input: TransactionInput = {
      date: '2025-01-15',
      description: 'Test',
      postings: [
        { account: 'expenses:dining', amount: 5.00 },
        { account: 'assets:checking', amount: -5.00 },
      ],
    }
    const output = formatTransaction(input)
    const postingLines = output.split('\n').filter(l => l.startsWith('    '))
    expect(postingLines.length).toBe(2)
    for (const line of postingLines) {
      expect(line.startsWith('    ')).toBe(true)
    }
  })

  it('formats amounts with exactly 2 decimal places', () => {
    const input: TransactionInput = {
      date: '2025-01-15',
      description: 'Test',
      postings: [
        { account: 'expenses:dining', amount: 5 },
        { account: 'assets:checking', amount: -5 },
      ],
    }
    const output = formatTransaction(input)
    expect(output).toContain('$5.00')
    expect(output).toContain('$-5.00')
  })

  it('includes status marker * in header line', () => {
    const input: TransactionInput = {
      date: '2025-01-15',
      status: '*',
      description: 'Cleared Transaction',
      postings: [
        { account: 'expenses:dining', amount: 5.00 },
        { account: 'assets:checking', amount: -5.00 },
      ],
    }
    const output = formatTransaction(input)
    expect(output).toContain('2025-01-15 * Cleared Transaction')
  })

  it('includes status marker ! in header line', () => {
    const input: TransactionInput = {
      date: '2025-01-15',
      status: '!',
      description: 'Pending Transaction',
      postings: [
        { account: 'expenses:dining', amount: 5.00 },
        { account: 'assets:checking', amount: -5.00 },
      ],
    }
    const output = formatTransaction(input)
    expect(output).toContain('2025-01-15 ! Pending Transaction')
  })

  it('omits status marker when status is empty string', () => {
    const input: TransactionInput = {
      date: '2025-01-15',
      status: '',
      description: 'No Status',
      postings: [
        { account: 'expenses:dining', amount: 5.00 },
        { account: 'assets:checking', amount: -5.00 },
      ],
    }
    const output = formatTransaction(input)
    expect(output).toContain('2025-01-15 No Status')
    // Should NOT have "2025-01-15  No Status" (double space from empty status)
    expect(output).not.toMatch(/2025-01-15\s{2,}No Status/)
  })
})

// --- appendTransaction() tests ---

import { appendTransaction } from '../journalWriter'
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { vi, beforeEach, afterEach } from 'vitest'

describe('appendTransaction()', () => {
  const testDir = join(process.cwd(), 'test-data', '__append-test__')
  const testJournal = join(testDir, 'test.journal')

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true })
    vi.stubEnv('LEDGER_FILE', testJournal)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(testDir, { recursive: true, force: true })
  })

  const validInput: TransactionInput = {
    date: '2025-01-15',
    status: '*',
    description: 'Coffee Shop',
    postings: [
      { account: 'expenses:dining', amount: 5.00 },
      { account: 'assets:checking', amount: -5.00 },
    ],
  }

  it('appends a valid transaction to the journal file', async () => {
    await writeFile(testJournal, '', 'utf-8')
    await appendTransaction(validInput)
    const content = await readFile(testJournal, 'utf-8')
    expect(content).toContain('2025-01-15 * Coffee Shop')
    expect(content).toContain('    expenses:dining  $5.00')
    expect(content).toContain('    assets:checking  $-5.00')
  })

  it('preserves existing journal content when appending', async () => {
    const existing = '2025-01-01 * Opening Balance\n    assets:checking  $1000.00\n    equity:opening\n'
    await writeFile(testJournal, existing, 'utf-8')
    await appendTransaction(validInput)
    const content = await readFile(testJournal, 'utf-8')
    expect(content).toContain('Opening Balance')
    expect(content).toContain('Coffee Shop')
    expect(content.indexOf('Opening Balance')).toBeLessThan(content.indexOf('Coffee Shop'))
  })

  it('throws an error with validation messages for invalid input', async () => {
    await writeFile(testJournal, '', 'utf-8')
    const invalidInput: TransactionInput = {
      date: 'bad-date',
      description: '',
      postings: [],
    }
    await expect(appendTransaction(invalidInput)).rejects.toThrow(/date/i)
  })

  it('does not modify the journal file when validation fails', async () => {
    const existing = 'existing content\n'
    await writeFile(testJournal, existing, 'utf-8')
    const invalidInput: TransactionInput = {
      date: 'bad-date',
      description: '',
      postings: [],
    }
    await expect(appendTransaction(invalidInput)).rejects.toThrow()
    const content = await readFile(testJournal, 'utf-8')
    expect(content).toBe(existing)
  })
})
