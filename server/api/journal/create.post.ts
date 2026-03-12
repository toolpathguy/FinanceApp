import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ filename?: string }>(event)

  if (!body?.filename || typeof body.filename !== 'string' || !body.filename.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Filename is required' })
  }

  const filename = body.filename.trim()

  if (!/\.(journal|hledger|j)$/.test(filename)) {
    throw createError({ statusCode: 400, statusMessage: 'Filename must end with .journal, .hledger, or .j' })
  }

  const dir = join(process.cwd(), 'journals')
  await mkdir(dir, { recursive: true })

  const filePath = join(dir, filename)
  await writeFile(filePath, '; hledger journal file\n', 'utf-8')

  return { success: true, path: filePath }
})
