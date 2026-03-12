import type { SimplifiedTransactionInput, SimplifiedFormState } from '~/types/ui'
import type { TransactionInput } from '~/types/api'
import { deriveTransactionType } from './deriveTransactionType'

/**
 * Converts a SimplifiedTransactionInput into a standard TransactionInput
 * with exactly 2 balanced postings.
 *
 * - Expense: posting[0] = {category, +amount}, posting[1] = {sourceAccount, -amount}
 * - Income:  posting[0] = {destAccount, +amount}, posting[1] = {category, -amount}
 * - Transfer: posting[0] = {transferAccount, +amount}, posting[1] = {sourceAccount, -amount}
 */
export function toTransactionInput(input: SimplifiedTransactionInput): TransactionInput {
  const { date, payee, account, type, category, transferAccount, amount, commodity = '$', status = '*' } = input

  let postings

  if (type === 'expense') {
    postings = [
      { account: category!, amount, commodity },
      { account, amount: -amount, commodity },
    ]
  }
  else if (type === 'income') {
    postings = [
      { account, amount, commodity },
      { account: category!, amount: -amount, commodity },
    ]
  }
  else {
    // transfer
    postings = [
      { account: transferAccount!, amount, commodity },
      { account, amount: -amount, commodity },
    ]
  }

  return { date, description: payee, postings, status }
}

/**
 * Converts a SimplifiedFormState (from the UI form) into a SimplifiedTransactionInput
 * suitable for the API, using deriveTransactionType() to determine the transaction type.
 */
export function formStateToInput(state: SimplifiedFormState): SimplifiedTransactionInput {
  const type = deriveTransactionType(state)
  const amount = parseFloat(state.inflow || state.outflow)

  return {
    date: state.date,
    payee: state.payee,
    account: state.account,
    type,
    category: type !== 'transfer' ? state.category : undefined,
    transferAccount: type === 'transfer' ? state.transferAccount : undefined,
    amount,
    status: state.status,
  }
}
