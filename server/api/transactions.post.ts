import type { TransactionInput } from '../../types/api'
import type { SimplifiedTransactionInput } from '../../types/ui'
import { appendTransaction } from '../utils/journalWriter'
import { appendSimplifiedTransaction } from '../utils/transactionWriter'

function isSimplifiedInput(body: any): body is SimplifiedTransactionInput {
  return typeof body.payee === 'string' && typeof body.type === 'string'
}

function isLegacyInput(body: any): body is TransactionInput {
  return typeof body.description === 'string' && Array.isArray(body.postings)
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  if (isSimplifiedInput(body)) {
    if (!body.date || !body.payee || !body.account) {
      throw createError({ statusCode: 400, message: 'Missing required fields' })
    }
    // Validate amount explicitly (Issue #4 item 2): the old `!body.amount` guard
    // rejected a legitimate 0 yet ACCEPTED negatives, which silently invert
    // posting signs downstream. In the YNAB model amounts are positive
    // magnitudes; direction comes from `type`.
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
      throw createError({ statusCode: 400, message: 'Amount must be a positive number' })
    }
    try {
      await appendSimplifiedTransaction(body)
    } catch (err: any) {
      throw createError({ statusCode: 400, message: err.message || 'Transaction validation failed' })
    }
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
    try {
      await appendTransaction(body)
    } catch (err: any) {
      throw createError({ statusCode: 400, message: err.message || 'Transaction validation failed' })
    }
    setResponseStatus(event, 201)
    return { success: true }
  }

  throw createError({ statusCode: 400, message: 'Unrecognized transaction format' })
})
