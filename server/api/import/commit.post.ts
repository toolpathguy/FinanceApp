import { getImportContext } from '../../utils/importContext'
import { computeDedupHash, loadJournalHashes } from '../../utils/importDedup'
import { normalizeDate } from '../../utils/importParse'
import { appendSimplifiedTransaction } from '../../utils/transactionWriter'
import type { SimplifiedTransactionInput } from '../../../types/ui'
import type { CommitRow, ImportCommitRequest, ImportCommitResponse } from '../../../types/import'

/**
 * POST /api/import/commit — write the user-approved import rows (Issue #9).
 *
 * This is the ONLY write path for the import feature. Each row is re-validated
 * server-side (R4.2), checked against the existing journal for duplicates
 * (skipped, not silently dropped — R5.3), and written via the shared
 * `appendSimplifiedTransaction` so the envelope accounting matches the rest of
 * the app. Partial success: one bad row never blocks the others.
 *
 * No Anthropic key is required here — committing is a local journal write.
 */

/** Uncategorized inflows land here, which raises net worth → Ready to Assign. */
const UNCATEGORIZED_INCOME = 'income:uncategorized'

function validateRow(
  row: CommitRow,
  accounts: Set<string>,
  envelopes: Set<string>,
): { ok: true; date: string } | { ok: false; error: string } {
  const date = normalizeDate(String(row.date ?? ''))
  if (!date) return { ok: false, error: 'Invalid date' }
  if (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0) {
    return { ok: false, error: 'Amount must be a positive number' }
  }
  if (row.direction !== 'inflow' && row.direction !== 'outflow') {
    return { ok: false, error: 'Invalid direction' }
  }
  if (!accounts.has(row.account)) {
    return { ok: false, error: `Unknown account: ${row.account || '(none)'}` }
  }
  if (row.direction === 'outflow') {
    // An outflow must hit a category to keep the budget balanced (R3.3 / R4.2).
    if (!row.envelope) return { ok: false, error: 'Outflows require an envelope' }
    if (!envelopes.has(row.envelope)) return { ok: false, error: `Unknown envelope: ${row.envelope}` }
  }
  return { ok: true, date }
}

function toSimplified(row: CommitRow, date: string): SimplifiedTransactionInput {
  if (row.direction === 'outflow') {
    return {
      date, payee: row.payee, account: row.account, type: 'expense',
      category: `expenses:${row.envelope}`, amount: row.amount,
    }
  }
  // Inflow → income; uncategorized lands in Ready to Assign (R3.4).
  return {
    date, payee: row.payee, account: row.account, type: 'income',
    category: UNCATEGORIZED_INCOME, amount: row.amount,
  }
}

export default defineEventHandler(async (event): Promise<ImportCommitResponse> => {
  const body = await readBody<ImportCommitRequest>(event)
  const rows = Array.isArray(body.rows) ? body.rows : []

  const context = await getImportContext()
  const accounts = new Set(context.accounts)
  const envelopes = new Set(context.envelopes)
  const journalHashes = await loadJournalHashes()

  let committed = 0
  const skippedDuplicates: CommitRow[] = []
  const failed: { row: CommitRow; error: string }[] = []

  for (const row of rows) {
    const v = validateRow(row, accounts, envelopes)
    if (!v.ok) {
      failed.push({ row, error: v.error })
      continue
    }

    const hash = computeDedupHash({ date: v.date, amount: row.amount, payee: row.payee })
    if (journalHashes.has(hash)) {
      skippedDuplicates.push(row)
      continue
    }

    try {
      await appendSimplifiedTransaction(toSimplified(row, v.date))
      committed++
      // NB: we do NOT add `hash` to the set here. Two identical approved rows in
      // one batch are legitimately distinct (R5.4) — both commit. Only hashes that
      // already existed in the journal are auto-skipped.
    } catch (err) {
      failed.push({ row, error: (err as Error).message || 'Failed to write transaction' })
    }
  }

  return { committed, skippedDuplicates, failed }
})
