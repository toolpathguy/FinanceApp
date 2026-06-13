import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join, sep } from 'node:path'

// Issue #2, R2: create/upload must confine writes to JOURNALS_DIR.

const mockWriteFile = vi.fn()
const mockMkdir = vi.fn()
vi.mock('node:fs/promises', () => ({
  writeFile: (...a: any[]) => mockWriteFile(...a),
  mkdir: (...a: any[]) => mockMkdir(...a),
}))

const mockReadBody = vi.fn()
vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('readBody', mockReadBody)
vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage: string }) => {
  const err = new Error(opts.statusMessage) as any
  err.statusCode = opts.statusCode
  return err
})

const { JOURNALS_DIR } = await import('../../../utils/journalFiles')
const { default: createJournal } = await import('../create.post')
const { default: uploadJournal } = await import('../upload.post')

const fakeEvent = {} as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/journal/create — path safety', () => {
  it('rejects traversal and does not write', async () => {
    mockReadBody.mockResolvedValue({ filename: '../../evil.journal' })
    await expect(createJournal(fakeEvent)).rejects.toMatchObject({ statusCode: 400 })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('rejects a bad extension', async () => {
    mockReadBody.mockResolvedValue({ filename: 'evil.txt' })
    await expect(createJournal(fakeEvent)).rejects.toMatchObject({ statusCode: 400 })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('writes a valid filename inside JOURNALS_DIR', async () => {
    mockReadBody.mockResolvedValue({ filename: 'budget.journal' })
    const res = await createJournal(fakeEvent)
    expect(res).toMatchObject({ success: true, path: join(JOURNALS_DIR, 'budget.journal') })
    expect(mockWriteFile).toHaveBeenCalledOnce()
    const [path] = mockWriteFile.mock.calls[0]!
    expect(String(path).startsWith(JOURNALS_DIR + sep)).toBe(true)
  })
})

describe('POST /api/journal/upload — path safety', () => {
  it('rejects traversal in filename and does not write', async () => {
    mockReadBody.mockResolvedValue({ content: 'x', filename: '../escape.journal' })
    await expect(uploadJournal(fakeEvent)).rejects.toMatchObject({ statusCode: 400 })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('now enforces the extension on upload', async () => {
    mockReadBody.mockResolvedValue({ content: 'x', filename: 'evil.txt' })
    await expect(uploadJournal(fakeEvent)).rejects.toMatchObject({ statusCode: 400 })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('writes a valid filename inside JOURNALS_DIR', async () => {
    mockReadBody.mockResolvedValue({ content: '; data', filename: 'import.journal' })
    await uploadJournal(fakeEvent)
    const [path, content] = mockWriteFile.mock.calls[0]!
    expect(path).toBe(join(JOURNALS_DIR, 'import.journal'))
    expect(content).toBe('; data')
  })

  it('writes to the active journal when no filename is given', async () => {
    process.env.LEDGER_FILE = 'test-data/sample.journal'
    mockReadBody.mockResolvedValue({ content: '; data' })
    await uploadJournal(fakeEvent)
    const [path] = mockWriteFile.mock.calls[0]!
    expect(path).toBe('test-data/sample.journal')
    expect(mockMkdir).not.toHaveBeenCalled()
  })
})
