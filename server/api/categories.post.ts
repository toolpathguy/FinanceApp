export default defineEventHandler(async (event) => {
  const body = await readBody<{ action: string; name: string }>(event)

  if (!body.action || !body.name?.trim()) {
    throw createError({ statusCode: 400, message: 'Missing required fields: action and name' })
  }

  const action = body.action
  const name = body.name.trim().toLowerCase()

  if (action !== 'create' && action !== 'delete') {
    throw createError({ statusCode: 400, message: 'Action must be "create" or "delete"' })
  }

  const today = new Date().toISOString().slice(0, 10)
  const account = `expenses:${name}`

  if (action === 'create') {
    await addTransaction({
      date: today,
      description: `Create category ${account}`,
      status: '*',
      postings: [
        { account, amount: 0, commodity: '$' },
        { account: 'equity:opening-balances', amount: 0, commodity: '$' },
      ],
    })
  } else {
    await addTransaction({
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
