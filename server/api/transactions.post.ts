import type { TransactionInput } from '../../types/api'
import type { SimplifiedTransactionInput } from '../../types/ui'
import { toTransactionInput } from '../../utils/toTransactionInput'
import { appendTransaction } from '../utils/journalWriter'

function isSimplifiedInput(body: any): body is SimplifiedTransactionInput {
  return typeof body.payee === 'string' && typeof body.type === 'string'
}

function isLegacyInput(body: any): body is TransactionInput {
  return typeof body.description === 'string' && Array.isArray(body.postings)
}

/**
 * Post-process a simplified expense to use envelope budget sub-accounts.
 * - For asset accounts: 2-posting (expense debit, budget sub-account credit)
 * - For liability accounts: 4-posting (expense debit, budget sub-account credit,
 *   pending credit card budget debit, liability credit)
 */
function applyEnvelopePostings(
  txInput: TransactionInput,
  body: SimplifiedTransactionInput,
): TransactionInput {
  if (body.type !== 'expense' || !body.category) {
    return txInput
  }

  const commodity = body.commodity ?? '$'
  const envelopeCategory = body.category.replace(/^expenses:/, '')

  if (body.account.startsWith('liabilities:')) {
    // Credit card expense: 4-posting structure
    const budgetBase = 'assets:checking'
    const liabilityName = body.account.replace(/^liabilities:/, '')
    return {
      ...txInput,
      postings: [
        { account: body.category, amount: body.amount, commodity },
        { account: `${budgetBase}:budget:${envelopeCategory}`, amount: -body.amount, commodity },
        { account: `${budgetBase}:budget:pending:${liabilityName}`, amount: body.amount, commodity },
        { account: body.account, amount: -body.amount, commodity },
      ],
    }
  }

  if (body.account.startsWith('assets:')) {
    // Regular expense: debit expense, credit budget sub-account
    return {
      ...txInput,
      postings: [
        { account: body.category, amount: body.amount, commodity },
        { account: `${body.account}:budget:${envelopeCategory}`, amount: -body.amount, commodity },
      ],
    }
  }

  return txInput
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  if (isSimplifiedInput(body)) {
    if (!body.date || !body.payee || !body.account || !body.amount) {
      throw createError({ statusCode: 400, message: 'Missing required fields' })
    }
    let txInput = toTransactionInput(body)
    txInput = applyEnvelopePostings(txInput, body)
    try {
      await appendTransaction(txInput)
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
