import { isValidPeriod } from '../utils/hledgerArgs'
import { getBudgetReport } from '../utils/budgetReport'

export default defineEventHandler(async (event) => {
  const { period } = getQuery(event)

  // Empty/whitespace is treated as absent (R4.5); a present period is validated
  // before reaching hledger to prevent flag injection (Issue #2, R4.4).
  const pd = period ? String(period).trim() : ''
  if (pd && !isValidPeriod(pd)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid period expression' })
  }

  // Report-building lives in server/utils/budgetReport.ts so it can be shared
  // with the AI `get_budget` tool (Issue #8) without duplicating accounting logic.
  return await getBudgetReport(pd)
})
