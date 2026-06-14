import { readFileSync } from 'node:fs'

/**
 * Active-journal selection (Issue #2, R3).
 *
 * The active journal is persisted to a small JSON file rather than held in
 * process.env, so the choice survives restart and doesn't race across requests.
 * This module owns reading that file; journal/activate.post owns writing it.
 *
 * NOTE: this lives separately from hledger.ts on purpose — hledger.ts is the
 * engine adapter and is guard-tested to never import `fs`.
 */

/** Default journal shipped with the app; also the final fallback. */
export const SAMPLE_JOURNAL = 'test-data/sample.journal'

/** Persisted active-journal selection (written by journal/activate.post). */
export const ACTIVE_JOURNAL_CONFIG = 'config/active-journal.json'

/**
 * Read the persisted active-journal path, or null if absent/unreadable/empty.
 * Never throws (R3.5).
 */
export function readActiveJournalPath(): string | null {
  try {
    const raw = readFileSync(ACTIVE_JOURNAL_CONFIG, 'utf-8')
    const path = (JSON.parse(raw) as { path?: unknown }).path
    if (typeof path === 'string' && path.trim()) return path
  } catch {
    // no/invalid config — caller falls back
  }
  return null
}
