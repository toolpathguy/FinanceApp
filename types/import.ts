// Wire + UI types for AI-assisted CSV transaction import (Issue #9).
//
// Flow: upload CSV → POST /api/import/parse returns ImportProposal[] (the AI's
// normalized mapping) → user reviews/edits in a staging table → POST /api/import/commit
// writes only the approved CommitRow[] via the shared journal writer. The parse
// route never writes; the commit route is the only write path.

/** Direction of money relative to the chosen real account. */
export type ImportDirection = 'inflow' | 'outflow'

/**
 * A normalized transaction the AI proposed from one CSV row. The model returns
 * date, payee, amount, direction, suggestedAccount, suggestedEnvelope, and the
 * verbatim sourceRow; the server enriches each row with id/dedupHash/
 * possibleDuplicate.
 */
export interface ImportProposal {
  /** Stable per-row id (index-based) used as the review-table key. */
  id: string
  /** Validated YYYY-MM-DD. */
  date: string
  payee: string
  /** Positive magnitude; sign is carried by `direction`, never here. */
  amount: number
  direction: ImportDirection
  /** Real account path (assets:/liabilities:), or '' if no confident match. */
  suggestedAccount: string
  /** Expense category key (e.g. "food:groceries"), or '' if uncategorized. */
  suggestedEnvelope: string
  /** sha256(date|cents|payeeLowercased) — see server/utils/importDedup. */
  dedupHash: string
  /** True when this hash already exists in the journal at parse time. */
  possibleDuplicate: boolean
  /** The original CSV line, shown so the user can verify the mapping. */
  sourceRow: string
}

/** A CSV row the model (or our normalizer) could not turn into a proposal. */
export interface DroppedRow {
  sourceRow: string
  reason: string
}

export interface ImportParseResponse {
  proposals: ImportProposal[]
  /** Valid dropdown options for the review table. */
  context: { accounts: string[]; envelopes: string[] }
  /** Rows that couldn't be parsed — surfaced, never silently dropped (R1.4). */
  droppedRows: DroppedRow[]
}

/** A row the user approved (and possibly edited) in the review table. */
export interface CommitRow {
  date: string
  payee: string
  amount: number
  direction: ImportDirection
  /** Chosen real account path. */
  account: string
  /** Chosen expense category; '' is allowed only for an inflow (→ Ready to Assign). */
  envelope: string
  dedupHash: string
}

export interface ImportCommitRequest {
  rows: CommitRow[]
}

export interface ImportCommitResponse {
  committed: number
  /** Rows skipped because their hash already exists in the journal (R5.3). */
  skippedDuplicates: CommitRow[]
  /** Rows that failed server-side validation, with the reason. */
  failed: { row: CommitRow; error: string }[]
}
