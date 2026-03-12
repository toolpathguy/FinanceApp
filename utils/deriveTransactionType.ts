import type { SimplifiedFormState, TransactionType } from '~/types/ui'

/**
 * Derives the transaction type from the current form state.
 *
 * - Returns `'transfer'` if `transferAccount` is non-empty
 * - Returns `'income'` if `inflow` is non-empty and `outflow` is empty
 * - Returns `'expense'` if `outflow` is non-empty and `inflow` is empty
 * - Throws if both `inflow` and `outflow` are filled
 */
export function deriveTransactionType(formState: SimplifiedFormState): TransactionType {
  if (formState.transferAccount) {
    return 'transfer'
  }

  const hasInflow = formState.inflow !== ''
  const hasOutflow = formState.outflow !== ''

  if (hasInflow && hasOutflow) {
    throw new Error('Cannot derive transaction type: both inflow and outflow are filled')
  }

  if (hasInflow) {
    return 'income'
  }

  return 'expense'
}
