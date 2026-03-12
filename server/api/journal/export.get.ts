import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolveJournalPath } from '../../utils/hledger'

export default defineEventHandler(async (event) => {
  const filePath = resolveJournalPath()

  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, statusMessage: 'Journal file not found' })
  }

  const content = await readFile(filePath, 'utf-8')

  setResponseHeader(event, 'Content-Type', 'text/plain')
  return content
})
