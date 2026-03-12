import type { TransactionInput } from '../../types/api'
import type { SimplifiedTransactionInput } from '../../types/ui'
import { toTransactionInput } from '../../utils/toTransactionInput'

function isSimplifiedInput(body: any): body is SimplifiedTransactionInput {
  return typeof body.payee === 'string' && typeof body.type === 'string'
}

function isLegacyInput(body: any): body is TransactionInput {
  return typeof body.description === 'string' && Array.isArray(body.postings)
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  if (isSimplifiedInput(body)) {
    if (!body.date || !body.payee || !body.account || !body.amount) {
      throw createError({ statusCode: 400, message: 'Missing required fields' })
    }
    const txInput = toTransactionInput(body)
    await addTransaction(txInput)
    setResponseStatus(event, 201)
    return { success: true }
  }

  if (isLegacyInput(body)) {
    if (!body.date || !body.description || !body.postings?.length) {
      throw createError({ statusCode: 400, message: 'Missing required fields' })
    }
    if (body.postings.length < 2) {
      throw createError({ statusCode: 400, message: 'At least 2 postings required' })
    }
    await addTransaction(body)
    setResponseStatus(event, 201)
    return { success: true }
  }

  throw createError({ statusCode: 400, message: 'Unrecognized transaction format' })
})
