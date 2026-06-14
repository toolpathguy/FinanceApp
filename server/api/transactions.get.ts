import { toRegisterRows } from '../../utils/toRegisterRows'
import { isValidDate, isValidAccount } from '../utils/hledgerArgs'

export default defineEventHandler(async (event) => {
  const { startDate, endDate, account } = getQuery(event)

  // Empty/whitespace params are treated as absent (R4.5); present ones are
  // validated before reaching hledger to prevent flag injection (Issue #2, R4).
  const sd = startDate ? String(startDate).trim() : ''
  const ed = endDate ? String(endDate).trim() : ''
  const acct = account ? String(account).trim() : ''

  if (sd && !isValidDate(sd)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid startDate; expected YYYY-MM-DD' })
  }
  if (ed && !isValidDate(ed)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid endDate; expected YYYY-MM-DD' })
  }
  if (acct && !isValidAccount(acct)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid account query' })
  }

  const args = ['print']
  if (sd) args.push('-b', sd)
  if (ed) args.push('-e', ed)
  // Pass the account query after `--` so it can never be read as an hledger flag.
  if (acct) args.push('--', acct)

  const raw = await hledgerExec(args)
  const transactions = transformTransactions(raw as any[])

  if (acct) {
    return toRegisterRows(transactions, acct)
  }

  return transactions
})
