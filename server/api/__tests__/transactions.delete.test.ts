import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock Nitro globals + fs ---

const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()
const mockResolveJournalPath = vi.fn(() => 'test.journal')
const mockGetQuery = vi.fn()

vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('getQuery', mockGetQuery)
vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage?: string; message?: string }) => {
  const err = new Error(opts.statusMessage || opts.message) as any
  err.statusCode = opts.statusCode
  err.statusMessage = opts.statusMessage
  return err
})
vi.stubGlobal('resolveJournalPath', mockResolveJournalPath)

vi.mock('node:fs/promises', () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
  writeFile: (...args: any[]) => mockWriteFile(...args),
}))

const { default: deleteTransaction } = await import('../transactions.delete')

const fakeEvent = {} as any

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveJournalPath.mockReturnValue('test.journal')
})

const FLAT_JOURNAL = [
  '2025-01-01 Opening',
  '    assets:checking  $100.00',
  '    equity:opening  $-100.00',
  '',
  '2025-01-02 Coffee',
  '    expenses:dining  $5.00',
  '    assets:checking  $-5.00',
  '',
].join('\n')

describe('DELETE /api/transactions — include guard (R7.1)', () => {
  it('rejects with 422 when the journal contains an include directive', async () => {
    mockGetQuery.mockReturnValue({ index: '1' })
    mockReadFile.mockResolvedValue(`include other.journal\n${FLAT_JOURNAL}`)

    await expect(deleteTransaction(fakeEvent)).rejects.toMatchObject({ statusCode: 422 })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('rejects an indented include directive too', async () => {
    mockGetQuery.mockReturnValue({ index: '1' })
    mockReadFile.mockResolvedValue(`  include sub.journal\n${FLAT_JOURNAL}`)

    await expect(deleteTransaction(fakeEvent)).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('DELETE /api/transactions — flat journal unchanged (R7.3)', () => {
  it('deletes the transaction at the given index from a flat journal', async () => {
    mockGetQuery.mockReturnValue({ index: '2' })
    mockReadFile.mockResolvedValue(FLAT_JOURNAL)
    mockWriteFile.mockResolvedValue(undefined)

    const result = await deleteTransaction(fakeEvent)

    expect(result).toEqual({ success: true })
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    const written = mockWriteFile.mock.calls[0]![1] as string
    expect(written).toContain('Opening')
    expect(written).not.toContain('Coffee')
  })

  it('returns 400 for a missing index', async () => {
    mockGetQuery.mockReturnValue({})
    await expect(deleteTransaction(fakeEvent)).rejects.toMatchObject({ statusCode: 400 })
  })
})
