import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveBudgetBase } from '../../utils/hledger'

// Issue #2, R4: read routes validate query params before spawning hledger and
// pass account queries after a `--` separator.

const mockHledgerExec = vi.fn()
const mockHledgerExecText = vi.fn()
const mockGetQuery = vi.fn()

vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('getQuery', mockGetQuery)
vi.stubGlobal('hledgerExec', mockHledgerExec)
vi.stubGlobal('hledgerExecText', mockHledgerExecText)
vi.stubGlobal('transformTransactions', (raw: any[]) => raw)
vi.stubGlobal('transformBalanceReport', () => ({ rows: [], totals: [] }))
vi.stubGlobal('resolveBudgetBase', resolveBudgetBase)
vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage?: string; message?: string }) => {
  const err = new Error(opts.statusMessage ?? opts.message) as any
  err.statusCode = opts.statusCode
  return err
})

const { default: getTransactions } = await import('../transactions.get')
const { default: getBudget } = await import('../budget.get')

const fakeEvent = {} as any

beforeEach(() => {
  vi.clearAllMocks()
  mockHledgerExec.mockResolvedValue([])
  mockHledgerExecText.mockResolvedValue('')
})

describe('GET /api/transactions — arg validation', () => {
  it('rejects a flag-like startDate without spawning hledger', async () => {
    mockGetQuery.mockReturnValue({ startDate: '--debug' })
    await expect(getTransactions(fakeEvent)).rejects.toMatchObject({ statusCode: 400 })
    expect(mockHledgerExec).not.toHaveBeenCalled()
  })

  it('rejects a flag-like account', async () => {
    mockGetQuery.mockReturnValue({ account: '-f/etc/passwd' })
    await expect(getTransactions(fakeEvent)).rejects.toMatchObject({ statusCode: 400 })
    expect(mockHledgerExec).not.toHaveBeenCalled()
  })

  it('passes a valid account after a -- separator', async () => {
    mockGetQuery.mockReturnValue({ account: 'assets:checking', startDate: '2025-01-01' })
    await getTransactions(fakeEvent)
    const args = mockHledgerExec.mock.calls[0]![0] as string[]
    expect(args).toContain('-b')
    expect(args).toContain('2025-01-01')
    const sepIdx = args.indexOf('--')
    expect(sepIdx).toBeGreaterThan(-1)
    expect(args[sepIdx + 1]).toBe('assets:checking')
  })

  it('treats empty params as absent (no validation error)', async () => {
    mockGetQuery.mockReturnValue({ account: '   ', startDate: '' })
    await getTransactions(fakeEvent)
    const args = mockHledgerExec.mock.calls[0]![0] as string[]
    expect(args).toEqual(['print'])
  })
})

describe('GET /api/budget — period validation', () => {
  it('rejects a flag-like period without spawning hledger', async () => {
    mockGetQuery.mockReturnValue({ period: '--debug' })
    await expect(getBudget(fakeEvent)).rejects.toMatchObject({ statusCode: 400 })
    expect(mockHledgerExec).not.toHaveBeenCalled()
    expect(mockHledgerExecText).not.toHaveBeenCalled()
  })

  it('accepts a valid period', async () => {
    mockGetQuery.mockReturnValue({ period: '2025-01' })
    const res = await getBudget(fakeEvent)
    expect(res).toMatchObject({ period: '2025-01' })
  })
})
