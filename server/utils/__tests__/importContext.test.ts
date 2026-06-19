import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ accounts: vi.fn() }))
// hledgerExecText is a Nitro auto-imported global at runtime.
vi.stubGlobal('hledgerExecText', (...a: any[]) => h.accounts(...a))

const { getImportContext } = await import('../importContext')

beforeEach(() => vi.clearAllMocks())

describe('getImportContext', () => {
  it('partitions real accounts from envelope keys and strips the expenses: prefix', async () => {
    h.accounts.mockResolvedValue([
      'assets:checking',
      'assets:savings',
      'liabilities:visa',
      'assets:checking:budget:food', // budget sub-account — not a real account target
      'expenses:food:groceries',
      'expenses:rent',
      'income:salary', // category but not an expense → not an envelope key
    ].join('\n'))

    const { accounts, envelopes } = await getImportContext()

    expect(accounts).toEqual(['assets:checking', 'assets:savings', 'liabilities:visa'])
    expect(envelopes).toEqual(['food:groceries', 'rent'])
  })

  it('is CRLF-safe and trims/ignores blank lines (Windows hledger output)', async () => {
    h.accounts.mockResolvedValue('assets:checking\r\nexpenses:rent\r\n\r\n')
    const { accounts, envelopes } = await getImportContext()
    expect(accounts).toEqual(['assets:checking'])
    expect(envelopes).toEqual(['rent'])
  })
})
