import { filterRealAccounts, filterCategoryAccounts } from '../../utils/filterAccounts'

/**
 * Valid targets the CSV-import AI may suggest (Issue #9).
 *
 * Returns the real accounts (assets:/liabilities:) the user can attribute a
 * transaction to, and the envelope keys (expense categories, "expenses:" prefix
 * stripped) it can land in. These ground the model's suggestions in real targets
 * and populate the review-table dropdowns. Read-only and delegation-only — it
 * reuses `hledgerExecText` (Nitro auto-imported) and the existing pure
 * `filterAccounts` helpers; no accounting logic here.
 *
 * CRLF-safe: hledger emits `\r\n` on Windows, so split on `/\r?\n/` and trim.
 */
export async function getImportContext(): Promise<{ accounts: string[]; envelopes: string[] }> {
  const raw = await hledgerExecText(['accounts'])
  const accounts = raw.trim().split(/\r?\n/).filter(Boolean).map(s => s.trim())

  const realAccounts = filterRealAccounts(accounts)
  // Envelope keys are expense categories with the "expenses:" prefix stripped, so
  // they match the budget sub-account naming the journal writer expects.
  const envelopes = filterCategoryAccounts(accounts)
    .filter(a => a.startsWith('expenses:'))
    .map(a => a.replace(/^expenses:/, ''))

  return { accounts: realAccounts, envelopes }
}
