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
    // Check if the envelope has a non-zero budget balance before hiding.
    // Hiding an envelope with money in it would make that money disappear
    // from the budget view, breaking the YNAB Rule 1 identity.
    const budgetKey = path.replace(/^expenses:/, '')
    const budgetAccount = `assets:checking:budget:${budgetKey}`
    try {
      const balRaw = await hledgerExec(['bal', budgetAccount])
      const balReport = transformBalanceReport(balRaw)
      const balance = balReport.totals?.[0]?.quantity ?? 0
      if (Math.abs(balance) > 0.001) {
        throw createError({
          statusCode: 400,
          message: `Cannot hide envelope with a balance of $${balance.toFixed(2)}. Transfer the remaining funds to another envelope first.`,
        })
      }
    } catch (err: any) {
      // If the error is our own 400, re-throw it
      if (err.statusCode === 400) throw err
      // Otherwise the budget account doesn't exist yet — safe to hide
    }

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
