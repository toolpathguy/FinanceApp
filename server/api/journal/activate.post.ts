import { existsSync } from 'node:fs'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ filename?: string }>(event)

  if (!body?.filename || typeof body.filename !== 'string' || !body.filename.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Filename is required' })
  }

  const filePath = body.filename.trim()

  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, statusMessage: 'Journal file not found' })
  }

  process.env.LEDGER_FILE = filePath

  return { success: true, path: filePath }
})
