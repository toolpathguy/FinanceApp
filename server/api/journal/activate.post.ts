import { existsSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { JOURNALS_DIR } from '../../utils/journalFiles'
import { SAMPLE_JOURNAL, ACTIVE_JOURNAL_CONFIG } from '../../utils/hledger'

/**
 * Activate a journal (Issue #2, R3).
 *
 * Only a managed journal (inside JOURNALS_DIR) or the bundled sample journal may
 * be activated — this closes the arbitrary-file-read hole. The client sends a
 * full path as listed by /api/journal/list; we resolve it and require it to be
 * contained in the journals dir (or be the sample). The choice is persisted to
 * config/active-journal.json (not process.env) so it survives restart and
 * doesn't race across requests.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ filename?: string }>(event)

  if (!body?.filename || typeof body.filename !== 'string' || !body.filename.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Filename is required' })
  }

  const resolved = resolve(body.filename.trim())
  const isSample = resolved === resolve(SAMPLE_JOURNAL)
  const isManaged = resolved.startsWith(JOURNALS_DIR + sep)

  if (!isSample && !isManaged) {
    throw createError({ statusCode: 400, statusMessage: 'Journal must be a managed file in the journals directory' })
  }

  if (!existsSync(resolved)) {
    throw createError({ statusCode: 404, statusMessage: 'Journal file not found' })
  }

  // Persist the choice (R3.3). Also set the env var for immediacy within the
  // current process (resolveJournalPath prefers the config file regardless).
  await mkdir(dirname(ACTIVE_JOURNAL_CONFIG), { recursive: true })
  await writeFile(ACTIVE_JOURNAL_CONFIG, JSON.stringify({ path: resolved }, null, 2), 'utf-8')
  process.env.LEDGER_FILE = resolved

  return { success: true, path: resolved }
})
