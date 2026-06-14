import type { HledgerTransaction } from '~/types/hledger'
import type { RegisterRow } from '~/types/ui'
import { stripAccountPrefix } from './stripAccountPrefix'

/**
 * Returns true if `account` belongs to the register's account *family*:
 * the requested account itself or any of its sub-accounts.
 *
 * For a real account this includes its envelope layer
 * (`assets:checking` + `assets:checking:budget:*`); for a budget envelope it is
 * scoped to that envelope's own sub-tree.
 */
function isFamilyPosting(account: string, accountPath: string): boolean {
  return account === accountPath || account.startsWith(accountPath + ':')
}

/**
 * Converts raw hledger transactions into YNAB-style register rows for an account.
 *
 * The register reflects the *real balance* of the account family
 * (`accountPath` + its sub-accounts). For each transaction we sum the net change
 * across the family; that net is the row's inflow/outflow and the running
 * balance tracks the family balance. Transactions whose net family change is
 * zero — budget assignments (checking→envelope), envelope transfers, credit-card
 * expenses that only move money between envelopes — are internal to the account
 * and omitted. Category/payee are derived from the postings *outside* the family
 * (the expense/income/other-account leg).
 *
 * `openingBalance` seeds the running balance (Issue #4 item 4). When a register
 * is date-filtered, callers pass the family balance as of the day before the
 * window so the Balance column reflects the true balance, not one reset to $0.
 * Defaults to 0 (full-history register).
 */
export function toRegisterRows(
  transactions: HledgerTransaction[],
  accountPath: string,
  openingBalance = 0,
): RegisterRow[] {
  let runningBalance = openingBalance
  const rows: RegisterRow[] = []

  for (const tx of transactions) {
    const familyPostings = tx.postings.filter(p => isFamilyPosting(p.account, accountPath))
    if (familyPostings.length === 0) continue

    // A family posting holding 2+ commodities can't be netted to a single
    // number — surface a clearly-marked row rather than silently using the
    // first commodity. (Single-commodity `$` is the norm in this app.)
    if (familyPostings.some(p => p.amounts.length > 1)) {
      rows.push({
        date: tx.date,
        payee: tx.description,
        category: 'Multiple currencies',
        categoryRaw: '',
        inflow: null,
        outflow: null,
        runningBalance, // carried forward — cannot aggregate across commodities
        isTransfer: false,
        transactionIndex: tx.index,
        status: tx.status,
      })
      continue
    }

    const net = familyPostings.reduce((sum, p) => sum + (p.amounts[0]?.quantity ?? 0), 0)

    // Internal move (nets to zero in the family) — not real account activity.
    if (Math.round(net * 100) === 0) continue

    const inflow = net > 0 ? net : null
    const outflow = net < 0 ? Math.abs(net) : null
    runningBalance += net

    // Derive category/payee from the postings outside the family.
    const otherPostings = tx.postings.filter(p => !isFamilyPosting(p.account, accountPath))

    if (otherPostings.length > 1) {
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

    const otherAccount = otherPostings[0]?.account ?? ''
    const isTransfer = otherAccount.startsWith('assets:') || otherAccount.startsWith('liabilities:')
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
