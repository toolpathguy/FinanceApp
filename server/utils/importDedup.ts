import { createHash } from 'node:crypto'
import { getTransactionList } from './transactionList'

/**
 * Duplicate detection for CSV import (Issue #9).
 *
 * A transaction's identity for dedup is (date, integer cents, normalized payee).
 * The hash is computed identically for proposals (to flag `possibleDuplicate`
 * against the existing journal at parse time) and for commit rows (to skip rows
 * already in the journal). Because every committed row becomes a real journal
 * entry, re-importing the same statement is caught by checking the journal — no
 * separate "imported ledger" file is needed, keeping the server stateless.
 *
 * Dedup is a SAFETY NET, not a silent drop: identical same-day transactions are
 * legitimate, so matches are surfaced for the user to confirm (R5).
 */

/** Stable identity hash: date + integer cents + lowercased/trimmed payee. */
export function computeDedupHash(input: { date: string; amount: number; payee: string }): string {
  const cents = Math.round(input.amount * 100)
  const payee = input.payee.trim().toLowerCase()
  return createHash('sha256').update(`${input.date}|${cents}|${payee}`).digest('hex')
}

/**
 * Build the set of dedup hashes already present in the journal. Reads via
 * `getTransactionList` (which yields one entry per category leg); the amount is
 * taken as a magnitude so the hash matches a proposal regardless of leg sign.
 */
export async function loadJournalHashes(): Promise<Set<string>> {
  const entries = await getTransactionList({ limit: 100000 })
  const hashes = new Set<string>()
  for (const e of entries) {
    hashes.add(computeDedupHash({ date: e.date, amount: Math.abs(e.amount), payee: e.payee }))
  }
  return hashes
}
