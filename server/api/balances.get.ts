export default defineEventHandler(async (event) => {
  const { period, account, depth } = getQuery(event)
  const args = ['bal']
  if (period) args.push('-p', String(period))
  if (account) args.push(String(account))
  if (depth) args.push('--depth', String(depth))
  return await hledgerExec(args)
})
