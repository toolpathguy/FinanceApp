import type { BudgetCategory, BudgetCategoryGroup, BudgetEnvelopeReport } from '../../types/ui'
import { stripAccountPrefix } from '../../utils/stripAccountPrefix'
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

/**
 * Maps an expense account path to its corresponding budget sub-account name.
 * e.g. "expenses:food:groceries" → "food:groceries"
 */
function expenseToBudgetKey(expenseAccount: string): string {
  // Strip the "expenses:" prefix to get the category path
  return expenseAccount.replace(/^expenses:/, '')
}

export default defineEventHandler(async (event) => {
  const { period } = getQuery(event)

  // 1. Fetch ALL expense accounts, filter out hidden ones
  const allAccountsRaw = await hledgerExecText(['accounts'])
  const allAccounts = allAccountsRaw.trim().split(/\r?\n/).filter(Boolean).map(s => s.trim())
  const hiddenSet = await loadHiddenEnvelopes()
  const expenseAccounts = allAccounts.filter(a => a.startsWith('expenses:') && !hiddenSet.has(a))

  // 2. Fetch period-filtered expense activity (Activity column)
  const expenseArgs = ['bal', 'expenses:']
  if (period) expenseArgs.push('-p', String(period))
  const expenseRaw = await hledgerExec(expenseArgs)
  const expenseReport = transformBalanceReport(expenseRaw)

  const activityMap = new Map<string, number>()
  for (const row of expenseReport.rows) {
    activityMap.set(row.account, row.amounts?.[0]?.quantity ?? 0)
  }

  // 3. Fetch budget sub-account data and real account totals
  //    a) Cumulative budget balances (no period) → Available column
  //    b) Period-scoped budget delta (with period) → derive this month's Assigned
  //    c) Real account totals → compute Ready to Assign via YNAB Rule 1
  const budgetBalanceMap = new Map<string, number>()   // cumulative Available
  const budgetPeriodDeltaMap = new Map<string, number>() // period net change
  let totalBudgetEnvelopes = 0  // sum of all non-unallocated budget sub-accounts
  let readyToAssign = 0

  try {
    // a) Cumulative balances — Available is the all-time running balance
    const cumulativeArgs = ['bal', 'assets:checking:budget:']
    const cumulativeRaw = await hledgerExec(cumulativeArgs)
    const cumulativeReport = transformBalanceReport(cumulativeRaw)

    let totalAllBudgetSubAccounts = 0
    for (const row of cumulativeReport.rows) {
      const account = row.account as string
      const balance = row.amounts?.[0]?.quantity ?? 0

      if (account.startsWith('assets:checking:budget:')) {
        totalAllBudgetSubAccounts += balance
        if (account !== 'assets:checking:budget:unallocated'
          && !account.startsWith('assets:checking:budget:pending:')) {
          const categoryKey = account.replace(/^assets:checking:budget:/, '')
          budgetBalanceMap.set(categoryKey, balance)
          totalBudgetEnvelopes += balance
        }
      }
    }

    // YNAB Rule 1: Ready to Assign = total real account balances - money in envelopes
    // Real accounts = assets + liabilities (net worth)
    // Money in envelopes = all budget sub-accounts except unallocated
    // So: Ready to Assign = net worth - (total envelopes + pending CC)
    // Which simplifies to: unallocated balance (since checking = sum of all budget sub-accounts)
    // Plus savings, minus credit card liability, etc.
    //
    // Actually the simplest correct formula:
    // Ready to Assign = sum(all real accounts: assets + liabilities) - sum(all non-unallocated budget sub-accounts)
    // This accounts for savings, credit cards, and any other real accounts.
    const realBalArgs = ['bal', 'assets:', 'liabilities:']
    const realBalRaw = await hledgerExec(realBalArgs)
    const realBalReport = transformBalanceReport(realBalRaw)
    const netRealBalance = realBalReport.totals?.[0]?.quantity ?? 0

    // Subtract all envelope balances (including pending CC) from net real balance
    const envelopesAndPending = totalAllBudgetSubAccounts
      - (cumulativeReport.rows.find((r: any) => r.account === 'assets:checking:budget:unallocated')?.amounts?.[0]?.quantity ?? 0)
    readyToAssign = netRealBalance - envelopesAndPending

    // b) Period-scoped delta — net change in budget sub-accounts this period
    if (period) {
      const periodArgs = ['bal', 'assets:checking:budget:', '-p', String(period)]
      const periodRaw = await hledgerExec(periodArgs)
      const periodReport = transformBalanceReport(periodRaw)

      for (const row of periodReport.rows) {
        const account = row.account as string
        const delta = row.amounts?.[0]?.quantity ?? 0
        if (account.startsWith('assets:checking:budget:')
          && account !== 'assets:checking:budget:unallocated'
          && !account.startsWith('assets:checking:budget:pending:')) {
          const categoryKey = account.replace(/^assets:checking:budget:/, '')
          budgetPeriodDeltaMap.set(categoryKey, delta)
        }
      }
    }
  } catch {
    // No budget sub-accounts yet — show $0 for everything (backward compatibility)
  }

  // 4. Build categories from expense accounts, overlaying budget data
  const groupMap = new Map<string, BudgetCategory[]>()

  for (const accountPath of expenseAccounts) {
    const isParent = expenseAccounts.some(a => a !== accountPath && a.startsWith(accountPath + ':'))
    if (isParent) continue

    const activity = activityMap.get(accountPath) ?? 0
    const budgetKey = expenseToBudgetKey(accountPath)

    // Available = cumulative running balance (includes rollover from all prior periods)
    const available = budgetBalanceMap.get(budgetKey) ?? 0

    // Assigned = this period's assignment amount
    // Budget sub-account period delta = assigned_this_period - spent_this_period
    // So: assigned_this_period = delta + |activity_this_period|
    let assigned: number
    if (period) {
      const periodDelta = budgetPeriodDeltaMap.get(budgetKey) ?? 0
      assigned = periodDelta + Math.abs(activity)
    } else {
      // No period filter: show all-time assigned = available + |all-time activity|
      assigned = available + Math.abs(activity)
    }

    const category: BudgetCategory = {
      name: stripAccountPrefix(accountPath),
      accountPath,
      assigned,
      activity,
      available,
    }

    const segments = accountPath.split(':')
    const groupKey = segments[1] ?? ''

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
    readyToAssign,
    categoryGroups,
    totalAssigned,
    totalActivity,
    totalAvailable,
  } satisfies BudgetEnvelopeReport
})
