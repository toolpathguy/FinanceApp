export default defineEventHandler(async (event) => {
  const { startDate, endDate, account } = getQuery(event)
  const args = ['print']
  if (startDate) args.push('-b', String(startDate))
  if (endDate) args.push('-e', String(endDate))
  if (account) args.push(String(account))
  return await hledgerExec(args)
})
