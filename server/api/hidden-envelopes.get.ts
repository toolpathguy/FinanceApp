import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const CONFIG_PATH = 'config/hidden-envelopes.json'

export default defineEventHandler(async () => {
  if (!existsSync(CONFIG_PATH)) return []
  const content = await readFile(CONFIG_PATH, 'utf-8')
  try {
    return JSON.parse(content) as string[]
  } catch {
    return []
  }
})
