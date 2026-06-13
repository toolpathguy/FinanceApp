import { writeFile, mkdir } from 'node:fs/promises'
import { resolveJournalPath } from '../../utils/hledger'
import { JOURNALS_DIR, safeJournalPath } from '../../utils/journalFiles'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ content?: string; filename?: string }>(event)

  if (!body?.content || typeof body.content !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Content is required' })
  }

  let filePath: string

  if (body.filename && typeof body.filename === 'string' && body.filename.trim()) {
    // Validates extension + rejects path traversal (Issue #2, R2.1-2.3).
    filePath = safeJournalPath(body.filename)
    await mkdir(JOURNALS_DIR, { recursive: true })
  } else {
    // No filename → write to the active journal (unchanged behavior, R2.4).
    filePath = resolveJournalPath()
  }

  await writeFile(filePath, body.content, 'utf-8')

  return { success: true }
})
