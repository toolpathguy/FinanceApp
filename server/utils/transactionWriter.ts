import type { TransactionInput } from '../../types/api'
import type { SimplifiedTransactionInput } from '../../types/ui'
import { toTransactionInput } from '../../utils/toTransactionInput'
import { appendTransaction } from './journalWriter'

/**
 * Shared simplified-transaction write path (Issue #9 extraction).
 *
 * The envelope-aware posting logic used to live inline in
 * `server/api/transactions.post.ts`. It is extracted here so both that route and
 * the CSV import commit route (`server/api/import/commit.post.ts`) write through
 * exactly the same accounting path — no envelope math duplicated across routes
 * (separation-of-concerns). Behaviour is unchanged from the original route.
 *
 * `resolveBudgetBase` is a Nitro auto-imported server util (no import needed),
 * matching the original inline code.
 */

/**
 * Post-process a simplified expense to use envelope budget sub-accounts.
 * - Asset accounts: 2-posting (expense debit, budget sub-account credit).
 * - Liability accounts: 4-posting (expense debit, budget sub-account credit,
 *   pending credit-card budget debit, liability credit).
 * Other transaction types / accounts pass through unchanged.
 */
async function applyEnvelopePostings(
  txInput: TransactionInput,
  body: SimplifiedTransactionInput,
): Promise<TransactionInput> {
  if (body.type !== 'expense' || !body.category) {
    return txInput
  }

  const commodity = body.commodity ?? '$'
  const envelopeCategory = body.category.replace(/^expenses:/, '')

  if (body.account.startsWith('liabilities:')) {
    // Credit card expense: 4-posting structure. Derive the budget base from the
    // journal (Issue #4 item 3) rather than hardcoding `assets:checking`, so a
    // non-default primary account routes its envelope postings correctly.
    const budgetBase = await resolveBudgetBase()
    const liabilityName = body.account.replace(/^liabilities:/, '')
    return {
      ...txInput,
      postings: [
        { account: body.category, amount: body.amount, commodity },
        { account: `${budgetBase}:budget:${envelopeCategory}`, amount: -body.amount, commodity },
        { account: `${budgetBase}:budget:pending:${liabilityName}`, amount: body.amount, commodity },
        { account: body.account, amount: -body.amount, commodity },
      ],
    }
  }

  if (body.account.startsWith('assets:')) {
    // Regular expense: debit expense, credit budget sub-account
    return {
      ...txInput,
      postings: [
        { account: body.category, amount: body.amount, commodity },
        { account: `${body.account}:budget:${envelopeCategory}`, amount: -body.amount, commodity },
      ],
    }
  }

  return txInput
}

/**
 * Convert a SimplifiedTransactionInput to balanced postings (applying envelope
 * sub-accounts for expenses) and append it to the active journal.
 *
 * @throws Error (from `appendTransaction`) with joined validation messages if the
 *   resulting transaction is invalid; the journal is never modified on failure.
 */
export async function appendSimplifiedTransaction(body: SimplifiedTransactionInput): Promise<void> {
  let txInput = toTransactionInput(body)
  txInput = await applyEnvelopePostings(txInput, body)
  await appendTransaction(txInput)
}
