import type { BudgetCategory, BudgetCategoryGroup, BudgetEnvelopeReport } from '../../types/ui'
import { stripAccountPrefix } from '../../utils/stripAccountPrefix'
import { filterCategoryAccounts } from '../../utils/filterAccounts'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

async function loadHiddenEnvelopes(): Promise<Set<string>> {
  const path = 'config/hidden-envelopes.json'
  if (!existsSync(path)) return new Set()
  try {
    const list = JSON.parse(await readFile(path, 'utf-8')) as string[]
    return new Set(list)
  } catch {
    return new Set()
  }
}

export default defineEventHandler(async (event) => {
  const { period } = getQuery(event)

  // 1. Always fetch ALL expense categories, then filter out hidden ones
  const allAccountsRaw = await hledgerExecText(['accounts'])
  const allAccounts = allAccountsRaw.trim().split(/\r?\n/).filter(Boolean).map(s => s.trim())
  const hiddenSet = await loadHiddenEnvelopes()
  const expenseAccounts = allAccounts.filter(a => a.startsWith('expenses:') && !hiddenSet.has(a))

  // 2. Fetch period-filtered expense activity (may be empty for months with no transactions)
  const expenseArgs = ['bal', 'expenses:']
  if (period) expenseArgs.push('-p', String(period))
  const expenseRaw = await hledgerExec(expenseArgs)
  const expenseReport = transformBalanceReport(expenseRaw)

  // Build a lookup of activity by account path
  const activityMap = new Map<string, number>()
  for (const row of expenseReport.rows) {
    activityMap.set(row.account, row.amounts?.[0]?.quantity ?? 0)
  }

  // 3. Fetch period-filtered income
  const incomeArgs = ['bal', 'income:']
  if (period) incomeArgs.push('-p', String(period))
  const incomeRaw = await hledgerExec(incomeArgs)
  const incomeReport = transformBalanceReport(incomeRaw)

  const incomeTotalQty = incomeReport.totals?.[0]?.quantity ?? 0
  const totalIncome = Math.abs(incomeTotalQty)

  // 4. Build categories from ALL known expense accounts, overlaying activity
  const groupMap = new Map<string, BudgetCategory[]>()

  for (const accountPath of expenseAccounts) {
    // Skip parent-only accounts (e.g., "expenses:food" when "expenses:food:groceries" exists)
    const isParent = expenseAccounts.some(a => a !== accountPath && a.startsWith(accountPath + ':'))
    if (isParent) continue

    const activity = activityMap.get(accountPath) ?? 0
    const assigned = 0
    const available = assigned - Math.abs(activity)

    const category: BudgetCategory = {
      name: stripAccountPrefix(accountPath),
      accountPath,
      assigned,
      activity,
      available,
    }

    const segments = accountPath.split(':')
    const groupKey = segments.length > 2 ? segments[1] : segments[1] ?? ''

    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, [])
    }
    groupMap.get(groupKey)!.push(category)
  }

  // 5. Build category groups with totals
  const categoryGroups: BudgetCategoryGroup[] = []
  for (const [key, categories] of groupMap) {
    const groupAssigned = categories.reduce((s, c) => s + c.assigned, 0)
    const groupActivity = categories.reduce((s, c) => s + c.activity, 0)
    const groupAvailable = categories.reduce((s, c) => s + c.available, 0)

    categoryGroups.push({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      categories,
      assigned: groupAssigned,
      activity: groupActivity,
      available: groupAvailable,
    })
  }

  const totalAssigned = categoryGroups.reduce((s, g) => s + g.assigned, 0)
  const totalActivity = categoryGroups.reduce((s, g) => s + g.activity, 0)
  const totalAvailable = categoryGroups.reduce((s, g) => s + g.available, 0)

  return {
    period: period ? String(period) : '',
    readyToAssign: totalIncome - totalAssigned,
    categoryGroups,
    totalAssigned,
    totalActivity,
    totalAvailable,
  } satisfies BudgetEnvelopeReport
})
