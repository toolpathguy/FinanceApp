import { appendTransaction } from '../../utils/journalWriter'
import type { TransactionInput } from '../../../types/api'

interface BudgetTransferRequest {
  date: string
  sourceEnvelope: string
  destinationEnvelope: string
  amount: number
}

export default defineEventHandler(async (event) => {
  const body = await readBody<BudgetTransferRequest>(event)

  // Validate required fields
  if (!body.date || typeof body.date !== 'string') {
    throw createError({ statusCode: 400, message: 'date is required and must be a string (YYYY-MM-DD)' })
  }

  if (!body.sourceEnvelope || typeof body.sourceEnvelope !== 'string') {
    throw createError({ statusCode: 400, message: 'sourceEnvelope is required and must be a string' })
  }

  if (!body.destinationEnvelope || typeof body.destinationEnvelope !== 'string') {
    throw createError({ statusCode: 400, message: 'destinationEnvelope is required and must be a string' })
  }

  if (typeof body.amount !== 'number' || body.amount <= 0) {
    throw createError({ statusCode: 400, message: 'amount must be a positive number' })
  }

  if (body.sourceEnvelope === body.destinationEnvelope) {
    throw createError({ statusCode: 400, message: 'sourceEnvelope and destinationEnvelope must be different' })
  }

  const transaction: TransactionInput = {
    date: body.date,
    status: '*',
    description: 'Budget Transfer',
    postings: [
      {
        account: body.destinationEnvelope,
        amount: body.amount,
      },
      {
        account: body.sourceEnvelope,
        amount: -body.amount,
      },
    ],
  }

  try {
    await appendTransaction(transaction)
  } catch (err: any) {
    throw createError({ statusCode: 400, message: err.message || 'Failed to write budget transfer' })
  }

  setResponseStatus(event, 201)
  return { success: true }
})
