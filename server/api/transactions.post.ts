import type { TransactionInput } from '../../types/api'

export default defineEventHandler(async (event) => {
  const body = await readBody<TransactionInput>(event)
  if (!body.date || !body.description || !body.postings?.length) {
    throw createError({ statusCode: 400, message: 'Missing required fields' })
  }
  if (body.postings.length < 2) {
    throw createError({ statusCode: 400, message: 'At least 2 postings required' })
  }
  await addTransaction(body)
  setResponseStatus(event, 201)
  return { success: true }
})
