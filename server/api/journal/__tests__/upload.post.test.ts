import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock Nitro globals + fs + path resolution ---

const mockReadBody = vi.fn()
const mockWriteFile = vi.fn()
const mockMkdir = vi.fn()

vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('readBody', mockReadBody)
vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage?: string; message?: string }) => {
  const err = new Error(opts.statusMessage || opts.message) as any
  err.statusCode = opts.statusCode
  err.statusMessage = opts.statusMessage
  return err
})

vi.mock('node:fs/promises', () => ({
  writeFile: (...args: any[]) => mockWriteFile(...args),
  mkdir: (...args: any[]) => mockMkdir(...args),
}))

vi.mock('../../../utils/hledger', () => ({
  resolveJournalPath: () => 'test.journal',
}))

const { default: uploadJournal } = await import('../upload.post')

const fakeEvent = {} as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/journal/upload — include guard (R7.2)', () => {
  it('rejects content containing an include directive with 422', async () => {
    mockReadBody.mockResolvedValue({ content: 'include other.journal\n2025-01-01 Test\n    a  $1\n    b  $-1\n' })

    await expect(uploadJournal(fakeEvent)).rejects.toMatchObject({ statusCode: 422 })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('accepts a flat journal without include directives', async () => {
    mockReadBody.mockResolvedValue({ content: '2025-01-01 Test\n    a  $1.00\n    b  $-1.00\n' })
    mockWriteFile.mockResolvedValue(undefined)

    const result = await uploadJournal(fakeEvent)
    expect(result).toEqual({ success: true })
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
  })

  it('returns 400 when content is missing', async () => {
    mockReadBody.mockResolvedValue({})
    await expect(uploadJournal(fakeEvent)).rejects.toMatchObject({ statusCode: 400 })
  })
})
