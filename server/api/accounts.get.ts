export default defineEventHandler(async () => {
  const output = await hledgerExecText(['accounts'])
  return output.trim().split(/\r?\n/).filter(Boolean).map(s => s.trim())
})
