import type { TransactionFormState } from '../types/ui'

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validates a TransactionFormState and returns an array of error messages.
 * Returns an empty array if the form is valid.
 */
export function validateTransactionForm(state: TransactionFormState): string[] {
  const errors: string[] = []

  if (!state.date || !DATE_REGEX.test(state.date)) {
    errors.push('Date must be in YYYY-MM-DD format')
  }

  if (!state.description.trim()) {
    errors.push('Description is required')
  }

  if (state.postings.length < 2) {
    errors.push('At least 2 postings are required')
  }

  for (let i = 0; i < state.postings.length; i++) {
    const posting = state.postings[i]
    if (posting && !posting.account.trim()) {
      errors.push(`Posting ${i + 1} must have an account`)
    }
  }

  return errors
}
