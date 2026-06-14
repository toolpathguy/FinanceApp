import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveJournalPath } from '../../utils/hledger'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ content?: string; filename?: string }>(event)

  if (!body?.content || typeof body.content !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Content is required' })
  }

  // The writable journal must be a single flat file: delete-by-index relies on
  // file date-line order matching hledger's tindex, which `include` breaks.
  if (/^\s*include\s+/m.test(body.content)) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Journals with include directives are not supported. Upload a single flat journal file.',
    })
  }

  let filePath: string

  if (body.filename && typeof body.filename === 'string' && body.filename.trim()) {
    const dir = join(process.cwd(), 'journals')
    await mkdir(dir, { recursive: true })
    filePath = join(dir, body.filename.trim())
  } else {
    filePath = resolveJournalPath()
  }

  await writeFile(filePath, body.content, 'utf-8')

  return { success: true }
})
