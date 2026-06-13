import { describe, it, expect, vi, beforeEach } from 'vitest'

// Issue #2, R1.4: POST /api/categories must reject control chars in `name`
// before they reach the journal via addTransaction (hledger `add` over stdin).

const mockAddTransaction = vi.fn()
const mockReadBody = vi.fn()
const mockSetResponseStatus = vi.fn()

vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('readBody', mockReadBody)
vi.stubGlobal('setResponseStatus', mockSetResponseStatus)
vi.stubGlobal('addTransaction', mockAddTransaction)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  const err = new Error(opts.message) as any
  err.statusCode = opts.statusCode
  return err
})

// Note: journalWriter is intentionally NOT mocked — categories.post imports the
// real fieldHasIllegalChars from it.
const { default: postCategories } = await import('../categories.post')

const fakeEvent = {} as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/categories — control-char guard', () => {
  it('returns 400 and does not write for a newline in the name', async () => {
    mockReadBody.mockResolvedValue({ action: 'create', name: 'food\n2020-01-01 Steal' })
    await expect(postCategories(fakeEvent)).rejects.toMatchObject({ statusCode: 400 })
    expect(mockAddTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 for a tab in the name', async () => {
    mockReadBody.mockResolvedValue({ action: 'create', name: 'food\tdrink' })
    await expect(postCategories(fakeEvent)).rejects.toMatchObject({ statusCode: 400 })
    expect(mockAddTransaction).not.toHaveBeenCalled()
  })

  it('accepts a normal category name and writes', async () => {
    mockReadBody.mockResolvedValue({ action: 'create', name: 'Groceries' })
    const res = await postCategories(fakeEvent)
    expect(res).toMatchObject({ success: true, account: 'expenses:groceries' })
    expect(mockAddTransaction).toHaveBeenCalledTimes(1)
  })
})
