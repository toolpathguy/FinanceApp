import { filterRealAccounts, filterCategoryAccounts } from '../../utils/filterAccounts'

export default defineEventHandler(async (event) => {
  const { type } = getQuery(event)
  const output = await hledgerExecText(['accounts'])
  const accounts = output.trim().split(/\r?\n/).filter(Boolean).map(s => s.trim())

  if (type === 'real') return filterRealAccounts(accounts)
  if (type === 'category') return filterCategoryAccounts(accounts)
  return accounts
})
