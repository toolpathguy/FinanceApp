import { appendTransaction } from '../../utils/journalWriter'
import type { TransactionInput, PostingInput } from '../../../types/api'

interface BudgetAssignRequest {
  date: string
  physicalAccount: string
  envelopes: Record<string, number>
}

export default defineEventHandler(async (event) => {
  const body = await readBody<BudgetAssignRequest>(event)

  // Validate required fields
  if (!body.date || typeof body.date !== 'string') {
    throw createError({ statusCode: 400, message: 'date is required and must be a string (YYYY-MM-DD)' })
  }

  if (!body.physicalAccount || typeof body.physicalAccount !== 'string') {
    throw createError({ statusCode: 400, message: 'physicalAccount is required and must be a string' })
  }

  if (!body.envelopes || typeof body.envelopes !== 'object' || Object.keys(body.envelopes).length === 0) {
    throw createError({ statusCode: 400, message: 'envelopes must be a non-empty object mapping category names to amounts' })
  }

  // Validate all envelope amounts are positive numbers
  for (const [category, amount] of Object.entries(body.envelopes)) {
    if (typeof amount !== 'number' || amount <= 0) {
      throw createError({ statusCode: 400, message: `Envelope "${category}" must have a positive amount` })
    }
  }

  // Build postings: credit each budget sub-account
  const postings: PostingInput[] = []
  let totalAssigned = 0

  for (const [category, amount] of Object.entries(body.envelopes)) {
    postings.push({
      account: `${body.physicalAccount}:budget:${category}`,
      amount,
    })
    totalAssigned += amount
  }

  // Debit the physical account
  // Note: balance assertion (= $0.00) is NOT included by default.
  // It should only be used in a full "assign all income" flow where
  // every dollar is distributed. A single-envelope assignment from
  // the budget page won't zero out checking, so asserting $0 would
  // cause hledger to reject the entire journal.
  postings.push({
    account: body.physicalAccount,
    amount: -Math.round(totalAssigned * 100) / 100,
  })

  const transaction: TransactionInput = {
    date: body.date,
    status: '*',
    description: 'Budget Assignment',
    postings,
  }

  try {
    await appendTransaction(transaction)
  } catch (err: any) {
    throw createError({ statusCode: 400, message: err.message || 'Failed to write budget assignment' })
  }

  setResponseStatus(event, 201)
  return { success: true }
})
