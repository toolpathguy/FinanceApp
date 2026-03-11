export default defineEventHandler(async () => {
  return await hledgerExec(['accounts'])
})
