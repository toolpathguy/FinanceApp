import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async () => {
  const dir = join(process.cwd(), 'journals')
  const files: string[] = []

  if (existsSync(dir)) {
    const entries = await readdir(dir)
    for (const entry of entries) {
      if (/\.(journal|hledger|j)$/.test(entry)) {
        files.push(join(dir, entry))
      }
    }
  }

  const samplePath = join(process.cwd(), 'test-data', 'sample.journal')
  if (existsSync(samplePath)) {
    files.push(samplePath)
  }

  const activeJournal = resolveJournalPath()

  return { files, activeJournal }
})
