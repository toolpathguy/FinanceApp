import type { BudgetCategory, BudgetCategoryGroup, BudgetEnvelopeReport } from '../../types/ui'
import { stripAccountPrefix } from '../../utils/stripAccountPrefix'
import { singleQuantity, MultiCommodityError } from '../../utils/singleQuantity'
import { isValidPeriod } from '../utils/hledgerArgs'
import { readFile } from 'node:fs/promises'
import { pathExists } from '../utils/fsExists'

async function loadHiddenEnvelopes(): Promise<Set<string>> {
  const path = 'config/hidden-envelopes.json'
  if (!(await pathExists(path))) return new Set()
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

  // Empty/whitespace is treated as absent (R4.5); a present period is validated
  // before reaching hledger to prevent flag injection (Issue #2, R4.4).
  const pd = period ? String(period).trim() : ''
  if (pd && !isValidPeriod(pd)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid period expression' })
  }

  // 1. Fetch ALL expense accounts, filter out hidden ones
  const allAccountsRaw = await hledgerExecText(['accounts'])
  const allAccounts = allAccountsRaw.trim().split(/\r?\n/).filter(Boolean).map(s => s.trim())
  const hiddenSet = await loadHiddenEnvelopes()
  const expenseAccounts = allAccounts.filter(a => a.startsWith('expenses:') && !hiddenSet.has(a))

  // Derive the budget base from the account list (Issue #4 item 3) — no extra
  // hledger call. All budget sub-account queries/keys hang off this prefix
  // instead of a hardcoded `assets:checking:budget:`.
  const budgetBase = await resolveBudgetBase(allAccounts)
  const budgetPrefix = `${budgetBase}:budget:`
  const unallocatedAccount = `${budgetPrefix}unallocated`
  const pendingPrefix = `${budgetPrefix}pending:`

  // 2. Fetch period-filtered expense activity (Activity column)
  const expenseArgs = ['bal', 'expenses:']
  if (pd) expenseArgs.push('-p', pd)
  const expenseRaw = await hledgerExec(expenseArgs)
  const expenseReport = transformBalanceReport(expenseRaw)

  const activityMap = new Map<string, number>()
  for (const row of expenseReport.rows) {
    activityMap.set(row.account, singleQuantity(row.amounts, `expense activity for ${row.account}`))
  }

  // 3. Fetch budget sub-account data and real account totals
  //    a) Cumulative budget balances (no period) → Available column
  //    b) Period-scoped budget delta (with period) → derive this month's Assigned
  //    c) Real account totals → compute Ready to Assign via YNAB Rule 1
  const budgetBalanceMap = new Map<string, number>()   // cumulative Available
  const budgetPeriodDeltaMap = new Map<string, number>() // period net change
  let readyToAssign = 0

  try {
    // a) Cumulative balances — Available is the all-time running balance
    const cumulativeArgs = ['bal', budgetPrefix]
    const cumulativeRaw = await hledgerExec(cumulativeArgs)
    const cumulativeReport = transformBalanceReport(cumulativeRaw)

    for (const row of cumulativeReport.rows) {
      const account = row.account as string
      if (account.startsWith(budgetPrefix)
        && account !== unallocatedAccount
        && !account.startsWith(pendingPrefix)) {
        const categoryKey = account.slice(budgetPrefix.length)
        budgetBalanceMap.set(categoryKey, singleQuantity(row.amounts, `budget balance for ${account}`))
      }
    }

    // Ready to Assign (YNAB Rule 1) = net worth − money in envelopes. The single
    // source of truth lives in server/utils/budgetData.ts and is shared with the
    // assign availability gate, so the report and the gate can never disagree.
    // Pass the data we already fetched so this adds only the real-balance read.
    readyToAssign = await getReadyToAssign({ budgetBase, cumulativeReport })

    // b) Period-scoped delta — net change in budget sub-accounts this period
    if (pd) {
      const periodArgs = ['bal', budgetPrefix, '-p', pd]
      const periodRaw = await hledgerExec(periodArgs)
      const periodReport = transformBalanceReport(periodRaw)

      for (const row of periodReport.rows) {
        const account = row.account as string
        const delta = singleQuantity(row.amounts, `budget period delta for ${account}`)
        if (account.startsWith(budgetPrefix)
          && account !== unallocatedAccount
          && !account.startsWith(pendingPrefix)) {
          const categoryKey = account.slice(budgetPrefix.length)
          budgetPeriodDeltaMap.set(categoryKey, delta)
        }
      }
    }
  } catch (err) {
    // A multi-commodity account is a real error — surface it, don't mask it as $0.
    if (err instanceof MultiCommodityError) throw err
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

    // Assigned = assignment amount, reverse-derived from the budget sub-account.
    // Identity: budgetDelta = assigned − spent, and spent = activity (signed:
    // an outflow is negative, a refund positive). So assigned = delta + activity
    // with SIGNED activity. Using |activity| would invent a phantom assignment
    // for refunds (a $20 refund would read as +$40 assigned).
    let assigned: number
    if (pd) {
      const periodDelta = budgetPeriodDeltaMap.get(budgetKey) ?? 0
      assigned = periodDelta + activity
    } else {
      // No period filter: all-time assigned = cumulative available + all-time activity.
      assigned = available + activity
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
    period: pd,
    readyToAssign,
    categoryGroups,
    totalAssigned,
    totalActivity,
    totalAvailable,
  } satisfies BudgetEnvelopeReport
})
