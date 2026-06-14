import { writeFile, mkdir } from 'node:fs/promises'
import { JOURNALS_DIR, safeJournalPath } from '../../utils/journalFiles'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ filename?: string }>(event)

  if (!body?.filename || typeof body.filename !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Filename is required' })
  }

  // Validates extension + rejects path traversal (Issue #2, R2).
  const filePath = safeJournalPath(body.filename)

  await mkdir(JOURNALS_DIR, { recursive: true })
  await writeFile(filePath, '; hledger journal file\n', 'utf-8')

  return { success: true, path: filePath }
})
