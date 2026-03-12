import type { HledgerTransaction } from '~/types/hledger'
import type { RegisterRow } from '~/types/ui'
import { stripAccountPrefix } from './stripAccountPrefix'

/**
 * Converts raw hledger transactions into YNAB-style register rows
 * for a given account.
 *
 * For each transaction, finds the posting matching `accountPath`,
 * derives payee/category/inflow/outflow from the "other" posting,
 * and computes a running balance as a cumulative sum.
 */
export function toRegisterRows(
  transactions: HledgerTransaction[],
  accountPath: string,
): RegisterRow[] {
  let runningBalance = 0
  const rows: RegisterRow[] = []

  for (const tx of transactions) {
    // Find the posting that matches the current account (exact or sub-account)
    const thisPosting = tx.postings.find(
      p => p.account === accountPath || p.account.startsWith(accountPath + ':'),
    )
    if (!thisPosting || !thisPosting.amounts[0]) continue

    const amount = thisPosting.amounts[0].quantity

    // Determine inflow vs outflow from sign
    const inflow = amount > 0 ? amount : null
    const outflow = amount < 0 ? Math.abs(amount) : null

    // Update running balance
    runningBalance += amount

    // Handle legacy transactions with >2 postings
    const otherPostings = tx.postings.filter(p => p !== thisPosting)
    const isSplit = otherPostings.length > 1

    if (isSplit) {
      rows.push({
        date: tx.date,
        payee: tx.description,
        category: 'Split',
        categoryRaw: '',
        inflow,
        outflow,
        runningBalance,
        isTransfer: false,
        transactionIndex: tx.index,
        status: tx.status,
      })
      continue
    }

    // Standard 2-posting transaction
    const otherPosting = otherPostings[0]
    const otherAccount = otherPosting?.account ?? ''

    const isTransfer = otherAccount.startsWith('assets:') || otherAccount.startsWith('liabilities:')

    // Derive display category and payee
    const category = isTransfer ? '' : stripAccountPrefix(otherAccount)
    const payee = isTransfer
      ? `Transfer: ${stripAccountPrefix(otherAccount)}`
      : tx.description

    rows.push({
      date: tx.date,
      payee,
      category,
      categoryRaw: otherAccount,
      inflow,
      outflow,
      runningBalance,
      isTransfer,
      transactionIndex: tx.index,
      status: tx.status,
    })
  }

  return rows
}
