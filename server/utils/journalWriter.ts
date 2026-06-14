import { appendFile } from 'node:fs/promises'
import type { TransactionInput } from '../../types/api'
import { resolveJournalPath } from './hledger'

/** Round a dollar amount to integer cents (the journal's unit of precision). */
function toCents(amount: number): number {
  return Math.round(amount * 100)
}

/**
 * Format a dollar amount as a 2-decimal string via integer cents, so that any
 * set of amounts whose cents sum to zero also sums to zero once written.
 * e.g. -5 → "$-5.00", 123.45 → "$123.45".
 */
function formatMoney(amount: number, commodity: string): string {
  return `${commodity}${(toCents(amount) / 100).toFixed(2)}`
}

/**
 * Validate a TransactionInput before writing to ensure journal integrity.
 *
 * Validation rules:
 * 1. Date must be valid YYYY-MM-DD
 * 2. Description must be non-empty
 * 3. At least 2 postings required
 * 4. All postings must have non-empty account names
 * 5. Postings with explicit amounts must sum to zero (balanced)
 * 6. At most one posting may omit the amount (hledger infers it)
 *
 * @returns Array of error strings. Empty array means valid.
 */
export function validateTransaction(input: TransactionInput): string[] {
  const errors: string[] = []

  // Rule 1: Date must be valid YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    errors.push('Invalid date format: must be YYYY-MM-DD')
  } else {
    const parts = input.date.split('-').map(Number)
    const year = parts[0]!
    const month = parts[1]!
    const day = parts[2]!
    const d = new Date(year, month - 1, day)
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
      errors.push('Invalid date: does not represent a real calendar date')
    }
  }

  // Rule 2: Description must be non-empty
  if (!input.description || input.description.trim().length === 0) {
    errors.push('Description must not be empty')
  }

  // Rule 3: At least 2 postings required
  if (!input.postings || input.postings.length < 2) {
    errors.push('At least 2 postings are required')
  }

  // Rule 4: All postings must have non-empty account names
  if (input.postings) {
    for (let i = 0; i < input.postings.length; i++) {
      const posting = input.postings[i]!
      if (!posting.account || posting.account.trim().length === 0) {
        errors.push(`Posting ${i + 1} has an empty account name`)
      }
    }
  }

  // Rule 5: Postings with explicit amounts must sum to zero.
  // Compare in integer cents (not a float tolerance) — the journal is written at
  // 2-decimal precision, so "balanced" means the cents sum is exactly zero.
  if (input.postings && input.postings.length >= 2) {
    const postingsWithAmounts = input.postings.filter(p => p.amount !== undefined)
    if (postingsWithAmounts.length === input.postings.length) {
      const centsSum = postingsWithAmounts.reduce((acc, p) => acc + toCents(p.amount!), 0)
      if (centsSum !== 0) {
        errors.push(`Postings with explicit amounts do not sum to zero (sum: ${(centsSum / 100).toFixed(2)})`)
      }
    }
  }

  // Rule 6: At most one posting may omit the amount
  if (input.postings) {
    const omittedCount = input.postings.filter(p => p.amount === undefined).length
    if (omittedCount > 1) {
      errors.push(`At most one posting may omit the amount (found ${omittedCount} without amounts)`)
    }
  }

  return errors
}

/**
 * Format a TransactionInput into valid hledger journal syntax.
 *
 * Format rules:
 * - First line: DATE [STATUS] DESCRIPTION
 * - Each posting: 4-space indent, account name, optional amount, optional balance assertion
 * - Amounts: commodity symbol (default $) + number with 2 decimal places
 * - Prepend \n separator, end with \n
 *
 * @returns Formatted hledger journal string
 */
export function formatTransaction(input: TransactionInput): string {
  const parts: string[] = [input.date]

  if (input.status === '*' || input.status === '!') {
    parts.push(input.status)
  }

  parts.push(input.description)

  const firstLine = parts.join(' ')
  const lines: string[] = [firstLine]

  for (const posting of input.postings) {
    const commodity = posting.commodity ?? '$'
    let line = `    ${posting.account}`

    if (posting.amount !== undefined) {
      line += `  ${formatMoney(posting.amount, commodity)}`
    }

    if (posting.balanceAssertion !== undefined) {
      line += `  = ${formatMoney(posting.balanceAssertion, commodity)}`
    }

    lines.push(line)
  }

  return '\n' + lines.join('\n') + '\n'
}

/**
 * Validate, format, and append a transaction to the active journal file.
 *
 * Steps: validate → format → fs.appendFile()
 * If validation fails, rejects with an Error containing all validation messages.
 * The journal file is never modified when validation fails.
 *
 * @throws Error with joined validation messages if input is invalid
 */
export async function appendTransaction(input: TransactionInput): Promise<void> {
  const errors = validateTransaction(input)
  if (errors.length > 0) {
    throw new Error(errors.join('; '))
  }

  const formatted = formatTransaction(input)
  const journalPath = resolveJournalPath()
  await appendFile(journalPath, formatted, 'utf-8')
}
