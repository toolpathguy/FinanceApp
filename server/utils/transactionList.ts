import { isValidDate, isValidAccount } from './hledgerArgs'
import type { HledgerTransaction, HledgerPosting } from '../../types/hledger'

export interface TransactionListEntry {
  date: string
  payee: string
  /** Net signed amount of the posting (outflow negative, inflow positive). */
  amount: number
  account: string
}

export interface TransactionListQuery {
  startDate?: string
  endDate?: string
  account?: string
  /** Max entries returned, most-recent-first. Defaults to 50 to bound tokens. */
  limit?: number
}

/** Sum a posting's amounts to a single number (single-commodity `$` is the norm). */
function postingAmount(amounts: { quantity: number }[]): number {
  return amounts.reduce((s, a) => s + a.quantity, 0)
}

/**
 * Compact transaction list for the AI `get_transactions` tool (Issue #8).
 *
 * Shapes hledger `print` output into `{date, payee, amount, account}` rows the
 * model can reason over. To keep it relevant to budgeting, we surface the
 * category legs (`expenses:` / `income:`) of each transaction; a transaction
 * with no category leg (e.g. an account-to-account transfer) falls back to its
 * non-budget legs so it isn't silently dropped. Most-recent-first, capped.
 *
 * Read-only and delegation-only — no accounting math here; it reuses
 * `hledgerExec` + `transformTransactions` and inherits their CRLF/cents handling.
 * Query params are validated (Issue #2) and the account is passed after `--` so
 * it can never be read as an hledger flag.
 *
 * @throws if a date or account query is malformed.
 */
export async function getTransactionList(query: TransactionListQuery = {}): Promise<TransactionListEntry[]> {
  const sd = query.startDate?.trim() || ''
  const ed = query.endDate?.trim() || ''
  const acct = query.account?.trim() || ''
  const limit = query.limit && query.limit > 0 ? query.limit : 50

  if (sd && !isValidDate(sd)) throw new Error('Invalid startDate; expected YYYY-MM-DD')
  if (ed && !isValidDate(ed)) throw new Error('Invalid endDate; expected YYYY-MM-DD')
  if (acct && !isValidAccount(acct)) throw new Error('Invalid account query')

  const args = ['print']
  if (sd) args.push('-b', sd)
  if (ed) args.push('-e', ed)
  if (acct) args.push('--', acct)

  const raw = await hledgerExec(args)
  const transactions: HledgerTransaction[] = transformTransactions(raw as any[])

  const entries: TransactionListEntry[] = []
  for (const tx of transactions) {
    const categoryLegs = tx.postings.filter(
      (p: HledgerPosting) => p.account.startsWith('expenses:') || p.account.startsWith('income:'),
    )
    const legs = categoryLegs.length > 0
      ? categoryLegs
      : tx.postings.filter((p: HledgerPosting) => !p.account.includes(':budget:'))
    for (const p of legs) {
      entries.push({
        date: tx.date,
        payee: tx.description,
        amount: postingAmount(p.amounts),
        account: p.account,
      })
    }
  }

  // print is chronological; most-recent-first, then cap to bound token usage.
  return entries.reverse().slice(0, limit)
}
