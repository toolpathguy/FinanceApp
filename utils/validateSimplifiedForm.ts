import type { SimplifiedFormState } from '~/types/ui'

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validates a SimplifiedFormState and returns an array of human-readable error messages.
 * Returns an empty array if the form is valid.
 */
export function validateSimplifiedForm(state: SimplifiedFormState): string[] {
  const errors: string[] = []

  // 1. Date must match YYYY-MM-DD format
  if (!state.date || !DATE_REGEX.test(state.date)) {
    errors.push('Date must be in YYYY-MM-DD format')
  }

  // 2. Payee must be non-empty
  if (!state.payee.trim()) {
    errors.push('Payee is required')
  }

  // 3. Account must be non-empty
  if (!state.account.trim()) {
    errors.push('Account is required')
  }

  // 4. Exactly one of inflow/outflow must be filled (not both, not neither)
  const hasInflow = state.inflow.trim() !== ''
  const hasOutflow = state.outflow.trim() !== ''

  if (hasInflow && hasOutflow) {
    errors.push('Enter either inflow or outflow, not both')
  }
  else if (!hasInflow && !hasOutflow) {
    errors.push('An amount is required — enter either inflow or outflow')
  }
  else {
    // 5. Amount must be a positive number
    const raw = hasInflow ? state.inflow.trim() : state.outflow.trim()
    const amount = Number(raw)
    if (Number.isNaN(amount) || amount <= 0) {
      errors.push('Amount must be a positive number')
    }
  }

  // 6. If not a transfer (transferAccount is empty), category is required
  const isTransfer = state.transferAccount.trim() !== ''

  if (!isTransfer && !state.category.trim()) {
    errors.push('Category is required for expenses and income')
  }

  // 7. If transfer, transferAccount must differ from account
  if (isTransfer && state.transferAccount.trim() === state.account.trim()) {
    errors.push('Transfer destination must be different from source account')
  }

  return errors
}
