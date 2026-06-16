import { appendTransaction, fieldHasIllegalChars } from '../utils/journalWriter'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ action: string; name: string }>(event)

  if (!body.action || !body.name?.trim()) {
    throw createError({ statusCode: 400, message: 'Missing required fields: action and name' })
  }

  // Reject control characters before they reach the journal (Issue #2, R1.4).
  // appendTransaction → validateTransaction also rejects these, but this
  // explicit pre-check returns a friendlier, category-specific 400 message.
  if (fieldHasIllegalChars(body.name)) {
    throw createError({ statusCode: 400, message: 'Category name must not contain newline or tab characters' })
  }

  const action = body.action
  const name = body.name.trim().toLowerCase()

  if (action !== 'create' && action !== 'delete') {
    throw createError({ statusCode: 400, message: 'Action must be "create" or "delete"' })
  }

  const today = new Date().toISOString().slice(0, 10)
  const account = `expenses:${name}`

  if (action === 'create') {
    await appendTransaction({
      date: today,
      description: `Create category ${account}`,
      status: '*',
      postings: [
        { account, amount: 0, commodity: '$' },
        { account: 'equity:opening-balances', amount: 0, commodity: '$' },
      ],
    })
  } else {
    await appendTransaction({
      date: today,
      description: `Close category ${account}`,
      status: '*',
      postings: [
        { account, amount: 0, commodity: '$' },
        { account: 'equity:opening-balances', amount: 0, commodity: '$' },
      ],
    })
  }

  setResponseStatus(event, 201)
  return { success: true, account }
})
