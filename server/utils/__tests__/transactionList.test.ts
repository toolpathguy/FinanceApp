import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHledgerExec = vi.fn()
vi.stubGlobal('hledgerExec', mockHledgerExec)
// transformTransactions is auto-imported; pass raw through (we feed shaped data).
vi.stubGlobal('transformTransactions', (raw: any) => raw)

const { getTransactionList } = await import('../transactionList')

beforeEach(() => {
  vi.clearAllMocks()
})

const tx = (date: string, description: string, postings: { account: string; q: number }[]) => ({
  date,
  status: '*',
  description,
  index: 0,
  postings: postings.map(p => ({ account: p.account, amounts: [{ commodity: '$', quantity: p.q }] })),
})

describe('getTransactionList', () => {
  it('surfaces category legs as compact rows, most-recent-first', async () => {
    mockHledgerExec.mockResolvedValue([
      tx('2025-03-01', 'Landlord', [
        { account: 'assets:checking', q: -1200 },
        { account: 'expenses:rent', q: 1200 },
      ]),
      tx('2025-03-05', 'Grocery Co', [
        { account: 'assets:checking', q: -50 },
        { account: 'expenses:food:groceries', q: 50 },
      ]),
    ])

    const list = await getTransactionList()

    expect(list).toEqual([
      { date: '2025-03-05', payee: 'Grocery Co', amount: 50, account: 'expenses:food:groceries' },
      { date: '2025-03-01', payee: 'Landlord', amount: 1200, account: 'expenses:rent' },
    ])
  })

  it('falls back to non-budget legs when a transaction has no category leg', async () => {
    mockHledgerExec.mockResolvedValue([
      tx('2025-03-02', 'Move to savings', [
        { account: 'assets:checking', q: -500 },
        { account: 'assets:savings', q: 500 },
      ]),
    ])

    const list = await getTransactionList()
    expect(list.map(e => e.account).sort()).toEqual(['assets:checking', 'assets:savings'])
  })

  it('caps results to the limit', async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      tx(`2025-03-${String(i + 1).padStart(2, '0')}`, `p${i}`, [{ account: 'expenses:misc', q: i + 1 }]),
    )
    mockHledgerExec.mockResolvedValue(many)

    const list = await getTransactionList({ limit: 3 })
    expect(list).toHaveLength(3)
    // most-recent-first
    expect(list[0]!.payee).toBe('p9')
  })

  it('passes a validated date filter through to hledger', async () => {
    mockHledgerExec.mockResolvedValue([])
    await getTransactionList({ startDate: '2025-03-01' })
    expect(mockHledgerExec).toHaveBeenCalledWith(expect.arrayContaining(['-b', '2025-03-01']))
  })

  it('rejects a malformed account query (arg-injection guard)', async () => {
    await expect(getTransactionList({ account: '--bad' })).rejects.toThrow('Invalid account query')
    expect(mockHledgerExec).not.toHaveBeenCalled()
  })

  it('rejects a malformed start date', async () => {
    await expect(getTransactionList({ startDate: 'not-a-date' })).rejects.toThrow('Invalid startDate')
  })
})
