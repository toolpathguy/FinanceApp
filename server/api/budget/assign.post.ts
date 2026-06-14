import { appendTransaction } from '../../utils/journalWriter'
import { toUnallocatedAccount } from '../../../utils/budgetAccounts'
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

  // Debit the unallocated pool (Ready-to-Assign), not bare checking. Assigning
  // moves money out of the pool into envelopes; reducing an assignment returns
  // it to the pool (budget/transfer → unallocated). Debiting the pool here makes
  // assign and reduce exact inverses and keeps bare checking at $0.
  // No balance assertion (= $0.00): a single-envelope assignment won't zero the
  // pool, so asserting $0 would make hledger reject the journal.
  postings.push({
    account: toUnallocatedAccount(body.physicalAccount),
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
