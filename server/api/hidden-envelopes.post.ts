import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const CONFIG_PATH = 'config/hidden-envelopes.json'

async function loadHidden(): Promise<string[]> {
  if (!existsSync(CONFIG_PATH)) return []
  try {
    return JSON.parse(await readFile(CONFIG_PATH, 'utf-8'))
  } catch {
    return []
  }
}

async function saveHidden(list: string[]): Promise<void> {
  if (!existsSync('config')) await mkdir('config', { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(list, null, 2), 'utf-8')
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ action: string; accountPath: string }>(event)

  if (!body.action || !body.accountPath?.trim()) {
    throw createError({ statusCode: 400, message: 'Missing required fields: action and accountPath' })
  }

  const hidden = await loadHidden()
  const path = body.accountPath.trim()

  if (body.action === 'hide') {
    if (!hidden.includes(path)) {
      hidden.push(path)
      await saveHidden(hidden)
    }
    return { success: true, hidden }
  }

  if (body.action === 'unhide') {
    const filtered = hidden.filter(h => h !== path)
    await saveHidden(filtered)
    return { success: true, hidden: filtered }
  }

  throw createError({ statusCode: 400, message: 'Action must be "hide" or "unhide"' })
})
