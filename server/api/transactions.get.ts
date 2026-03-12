import { toRegisterRows } from '../../utils/toRegisterRows'

export default defineEventHandler(async (event) => {
  const { startDate, endDate, account } = getQuery(event)
  const args = ['print']
  if (startDate) args.push('-b', String(startDate))
  if (endDate) args.push('-e', String(endDate))
  if (account) args.push(String(account))
  const raw = await hledgerExec(args)
  const transactions = transformTransactions(raw as any[])

  if (account) {
    return toRegisterRows(transactions, String(account))
  }

  return transactions
})
