import type { SimplifiedTransactionInput, SimplifiedFormState } from '~/types/ui'
import type { TransactionInput } from '~/types/api'
import { deriveTransactionType } from './deriveTransactionType'

/**
 * Converts a SimplifiedTransactionInput into a standard TransactionInput
 * with exactly 2 balanced postings.
 *
 * - Expense: posting[0] = {category, +amount}, posting[1] = {sourceAccount, -amount}
 * - Income:  posting[0] = {destAccount, +amount}, posting[1] = {category, -amount}
 * - Transfer (out): posting[0] = {transferAccount, +amount}, posting[1] = {account, -amount}
 * - Transfer (in):  posting[0] = {account, +amount}, posting[1] = {transferAccount, -amount}
 */
export function toTransactionInput(input: SimplifiedTransactionInput): TransactionInput {
  const { date, payee, account, type, category, transferAccount, direction = 'out', amount, commodity = '$', status = '*' } = input

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
  else if (direction === 'in') {
    // transfer in — money enters the current account
    postings = [
      { account, amount, commodity },
      { account: transferAccount!, amount: -amount, commodity },
    ]
  }
  else {
    // transfer out — money leaves the current account
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
    // For a transfer, the filled column decides direction relative to `account`:
    // Inflow column → money in; Outflow column → money out.
    direction: type === 'transfer' ? (state.inflow ? 'in' : 'out') : undefined,
    amount,
    status: state.status,
  }
}
