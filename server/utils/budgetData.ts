import { singleQuantity, type CommodityAmount } from '../../utils/singleQuantity'

/**
 * Half a cent — smaller than any real assignment, larger than float drift from
 * cents-rounding. Used to compare an assignment total against available funds
 * without rejecting an exactly-affordable assignment over a rounding hair.
 */
export const READY_TO_ASSIGN_EPSILON = 0.005

interface BalanceRow {
  account?: string
  amounts?: CommodityAmount[]
}

interface BalanceReport {
  rows: BalanceRow[]
  totals?: CommodityAmount[]
}

export interface ReadyToAssignInputs {
  /** Pre-resolved budget base, to skip re-reading the account list. */
  budgetBase?: string
  /** Pre-fetched cumulative budget balances (`bal <base>:budget:`), to skip the read. */
  cumulativeReport?: BalanceReport
}

/**
 * Ready to Assign (YNAB Rule 1): the pool of money that exists but isn't yet
 * earmarked.
 *
 *   RTA = net real balance (all assets + liabilities) − sum of envelope balances
 *
 * "Money that exists" is **net worth across all real accounts**, not the balance
 * of any single account — so funds physically held in savings count toward what
 * can be assigned even when the budget-host account (checking) is empty
 * (GitHub Issue #7). The single source of truth for this figure; consumed by
 * `GET /api/budget` (the report) and by the assign endpoint (the availability
 * gate), so the two can never disagree.
 *
 * Callers that have already fetched the budget base and/or cumulative budget
 * balances (the report path) may pass them via {@link ReadyToAssignInputs} to
 * avoid redundant hledger calls; the assign path calls it with no inputs and it
 * fetches everything itself. Always issues one `bal assets: liabilities:` read.
 *
 * @throws MultiCommodityError if a budget or real account holds >1 commodity.
 */
export async function getReadyToAssign(inputs: ReadyToAssignInputs = {}): Promise<number> {
  let budgetBase = inputs.budgetBase
  if (budgetBase === undefined) {
    const allAccountsRaw = await hledgerExecText(['accounts'])
    const allAccounts = allAccountsRaw.trim().split(/\r?\n/).filter(Boolean).map(s => s.trim())
    budgetBase = await resolveBudgetBase(allAccounts)
  }
  const budgetPrefix = `${budgetBase}:budget:`
  const unallocatedAccount = `${budgetPrefix}unallocated`

  const cumulativeReport: BalanceReport = inputs.cumulativeReport
    ?? transformBalanceReport(await hledgerExec(['bal', budgetPrefix]))

  // Sum every budget sub-account, then back out unallocated → money sitting in
  // named envelopes (+ pending CC).
  let totalAllBudgetSubAccounts = 0
  for (const row of cumulativeReport.rows) {
    const account = row.account ?? ''
    if (account.startsWith(budgetPrefix)) {
      totalAllBudgetSubAccounts += singleQuantity(row.amounts, `budget balance for ${account}`)
    }
  }
  const unallocatedRow = cumulativeReport.rows.find(r => r.account === unallocatedAccount)
  const envelopesAndPending = totalAllBudgetSubAccounts
    - singleQuantity(unallocatedRow?.amounts, 'unallocated balance')

  // Net worth across every real account (assets + liabilities).
  const realBalReport: BalanceReport = transformBalanceReport(await hledgerExec(['bal', 'assets:', 'liabilities:']))
  const netRealBalance = singleQuantity(realBalReport.totals, 'net real account balance')

  return netRealBalance - envelopesAndPending
}
