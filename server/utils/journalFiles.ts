import { basename, join, resolve, sep } from 'node:path'

/**
 * Journal file path safety (Issue #2, R2 — path-traversal prevention).
 *
 * All managed journals live in this directory. Creating/uploading/activating a
 * journal must never escape it.
 */
export const JOURNALS_DIR = join(process.cwd(), 'journals')

const JOURNAL_EXT = /\.(journal|hledger|j)$/

/**
 * Validate a user-supplied journal filename and return its safe absolute path
 * inside {@link JOURNALS_DIR}.
 *
 * Rejects (via `createError` 400):
 * - empty/whitespace names
 * - any path separator or `..` segment (`basename(name) !== name`)
 * - names not ending in `.journal` / `.hledger` / `.j`
 * - resolved paths that escape the journals directory (belt-and-suspenders)
 *
 * @returns the validated absolute path within JOURNALS_DIR
 */
export function safeJournalPath(filename: string): string {
  const name = (filename ?? '').trim()

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Filename is required' })
  }

  // basename strips any directory component; if the result differs, the input
  // contained a separator (`/` or `\`) or a `..`/`.` traversal segment.
  if (basename(name) !== name) {
    throw createError({ statusCode: 400, statusMessage: 'Filename must not contain a path' })
  }

  if (!JOURNAL_EXT.test(name)) {
    throw createError({ statusCode: 400, statusMessage: 'Filename must end with .journal, .hledger, or .j' })
  }

  const full = resolve(JOURNALS_DIR, name)
  if (full !== join(JOURNALS_DIR, name) || !full.startsWith(JOURNALS_DIR + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Resolved path escapes the journals directory' })
  }

  return full
}
