import { describe, it, expect, afterEach } from 'vitest'
import fc from 'fast-check'
import { formatTransaction, validateTransaction, appendTransaction } from '../journalWriter'
import type { TransactionInput, PostingInput } from '../../../types/api'
import { writeFile, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// --- Arbitrary Helpers ---

/** Generates valid YYYY-MM-DD date strings */
function arbDate(): fc.Arbitrary<string> {
  return fc
    .record({
      year: fc.integer({ min: 2000, max: 2099 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
    })
    .map(({ year, month, day }) =>
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    )
}

/** Generates valid colon-separated lowercase account names (e.g., `assets:checking`) */
function arbAccountName(): fc.Arbitrary<string> {
  return fc
    .array(fc.stringMatching(/^[a-z]{2,10}$/), { minLength: 1, maxLength: 4 })
    .map((segments) => segments.join(':'))
}

/**
 * Generates 2+ postings where all amounts are explicit and sum to zero.
 * Strategy: generate N-1 arbitrary amounts, then set the last amount to -sum of the rest.
 */
function arbBalancedPostings(): fc.Arbitrary<PostingInput[]> {
  return fc
    .record({
      accounts: fc.array(arbAccountName(), { minLength: 2, maxLength: 6 })
        .filter((accs) => new Set(accs).size === accs.length), // unique accounts
      amounts: fc.array(
        fc.integer({ min: -1000000, max: 1000000 }).filter((n) => n !== 0).map((n) => n / 100),
        { minLength: 1, maxLength: 5 }
      ),
    })
    .filter(({ accounts, amounts }) => amounts.length <= accounts.length - 1)
    .map(({ accounts, amounts }) => {
      const sum = amounts.reduce((a, b) => a + b, 0)
      // Round the balancing amount to 2 decimal places to avoid floating point drift
      const balancingAmount = -Math.round(sum * 100) / 100
      const allAmounts = [...amounts, balancingAmount]

      return allAmounts.map((amount, i) => ({
        account: accounts[i]!,
        amount,
      }))
    })
}

/** Generates a valid TransactionInput with all explicit balanced amounts */
function arbTransactionInput(): fc.Arbitrary<TransactionInput> {
  return fc
    .record({
      date: arbDate(),
      description: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,29}$/)
        .map((s) => s.trimEnd())
        .filter((s) => s.length > 0),
      postings: arbBalancedPostings(),
      status: fc.constantFrom('' as const, '!' as const, '*' as const),
    })
    .map(({ date, description, postings, status }) => ({
      date,
      description,
      postings,
      ...(status ? { status } : {}),
    }))
}

// --- Property Tests ---

/**
 * Property P7: Posting amounts always balance
 * For any valid TransactionInput with all explicit amounts,
 * the sum of posting amounts in formatted output equals zero.
 *
 * **Validates: Requirements 2.5**
 */
describe('P7: Posting amounts always balance', () => {
  it('sum of parsed posting amounts in formatted output equals zero', () => {
    fc.assert(
      fc.property(arbTransactionInput(), (input) => {
        // Verify the input passes validation first
        const errors = validateTransaction(input)
        expect(errors).toEqual([])

        const output = formatTransaction(input)

        // Parse amounts back from the formatted output
        // Posting lines start with 4 spaces and contain amounts like $123.45 or $-123.45
        const postingLines = output.split('\n').filter((line) => line.startsWith('    '))
        const amounts: number[] = []

        for (const line of postingLines) {
          // Match commodity + amount pattern: $123.45 or $-123.45
          // But NOT balance assertion amounts (preceded by "= ")
          // Extract the posting amount (first dollar amount, not after "=")
          const parts = line.split('  = ') // split off balance assertion
          const postingPart = parts[0]!
          const amountMatch = postingPart.match(/\$(-?\d+\.\d{2})/)
          if (amountMatch) {
            amounts.push(parseFloat(amountMatch[1]!))
          }
        }

        // All postings have explicit amounts, so we should parse them all back
        expect(amounts.length).toBe(input.postings.length)

        // Sum must be zero (within floating point tolerance)
        const sum = amounts.reduce((a, b) => a + b, 0)
        expect(Math.abs(sum)).toBeLessThanOrEqual(0.01)
      }),
      { numRuns: 200 }
    )
  })
})

/**
 * Property P6: Formatted transactions are parseable by hledger
 * For any valid TransactionInput, formatTransaction() output is valid hledger journal syntax.
 *
 * We verify structural properties of the output rather than calling hledger directly:
 * - Starts with \n
 * - First non-empty line contains the date
 * - Each posting line starts with 4 spaces
 * - Contains the account name
 * - If amount is present, contains the commodity and a number with 2 decimal places
 *
 * **Validates: Requirements 1.1**
 */
describe('P6: Formatted transactions are parseable by hledger', () => {
  it('output has valid hledger journal structure', () => {
    fc.assert(
      fc.property(arbTransactionInput(), (input) => {
        const errors = validateTransaction(input)
        expect(errors).toEqual([])

        const output = formatTransaction(input)

        // Must start with \n (transaction separator)
        expect(output.startsWith('\n')).toBe(true)

        // Must end with \n
        expect(output.endsWith('\n')).toBe(true)

        const lines = output.split('\n')
        // First line is empty (from leading \n), second line is the header
        const nonEmptyLines = lines.filter((l) => l.length > 0)
        expect(nonEmptyLines.length).toBeGreaterThanOrEqual(1 + input.postings.length)

        // First non-empty line (header) contains the date
        const headerLine = nonEmptyLines[0]!
        expect(headerLine).toContain(input.date)

        // Header contains the description
        expect(headerLine).toContain(input.description)

        // If status is set, header contains it
        if (input.status === '*' || input.status === '!') {
          expect(headerLine).toContain(input.status)
        }

        // Posting lines start with 4 spaces
        const postingLines = nonEmptyLines.slice(1)
        expect(postingLines.length).toBe(input.postings.length)

        for (let i = 0; i < postingLines.length; i++) {
          const line = postingLines[i]!
          const posting = input.postings[i]!

          // Must start with 4-space indent
          expect(line.startsWith('    ')).toBe(true)

          // Must contain the account name
          expect(line).toContain(posting.account)

          // If amount is present, must contain commodity and 2-decimal number
          if (posting.amount !== undefined) {
            const commodity = posting.commodity ?? '$'
            expect(line).toContain(commodity)
            // Check for a number with exactly 2 decimal places
            expect(line).toMatch(/\d+\.\d{2}/)
          }

          // If balance assertion is present, must contain "= " followed by amount
          if (posting.balanceAssertion !== undefined) {
            const commodity = posting.commodity ?? '$'
            expect(line).toMatch(new RegExp(`=\\s+\\${commodity}-?\\d+\\.\\d{2}`))
          }
        }
      }),
      { numRuns: 200 }
    )
  })
})


/**
 * Property P8: Append is non-destructive
 * For any journal file content and valid TransactionInput,
 * appending the formatted transaction preserves all existing content.
 *
 * **Validates: Requirements 3.2**
 */
describe('P8: Append is non-destructive', () => {
  const originalLedgerFile = process.env.LEDGER_FILE
  let tempFile: string | undefined

  afterEach(async () => {
    // Restore env
    if (originalLedgerFile !== undefined) {
      process.env.LEDGER_FILE = originalLedgerFile
    } else {
      delete process.env.LEDGER_FILE
    }
    // Clean up temp file
    if (tempFile) {
      try {
        await unlink(tempFile)
      } catch {
        // ignore if already removed
      }
      tempFile = undefined
    }
  })

  it('existing journal content is preserved after appendTransaction()', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        arbTransactionInput(),
        async (existingContent, input) => {
          // Create a temp file with the existing content
          tempFile = join(tmpdir(), `p8-test-${Date.now()}-${Math.random().toString(36).slice(2)}.journal`)
          await writeFile(tempFile, existingContent, 'utf-8')

          // Point resolveJournalPath to our temp file
          process.env.LEDGER_FILE = tempFile

          // Append the transaction
          await appendTransaction(input)

          // Read the file back
          const result = await readFile(tempFile, 'utf-8')

          // The file must start with the original content
          expect(result.startsWith(existingContent)).toBe(true)

          // The file must be longer than the original (transaction was appended)
          expect(result.length).toBeGreaterThan(existingContent.length)

          // The appended portion should equal the formatted transaction
          const appended = result.slice(existingContent.length)
          const expected = formatTransaction(input)
          expect(appended).toBe(expected)
        }
      ),
      { numRuns: 50 }
    )
  })
})
