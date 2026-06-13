import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join, resolve } from 'node:path'

// Issue #2, R3: activation is restricted to managed journals + the sample, and
// the choice is persisted to config/active-journal.json (not process.env only).

const mockExistsSync = vi.fn()
vi.mock('node:fs', () => ({ existsSync: (...a: any[]) => mockExistsSync(...a) }))

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
const { SAMPLE_JOURNAL, ACTIVE_JOURNAL_CONFIG } = await import('../../../utils/hledger')
const { default: activate } = await import('../activate.post')

const fakeEvent = {} as any

beforeEach(() => {
  vi.clearAllMocks()
  mockExistsSync.mockReturnValue(true)
})

describe('POST /api/journal/activate — restricted activation', () => {
  it('rejects an arbitrary absolute path and persists nothing', async () => {
    mockReadBody.mockResolvedValue({ filename: '/etc/passwd' })
    await expect(activate(fakeEvent)).rejects.toMatchObject({ statusCode: 400 })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('rejects traversal and persists nothing', async () => {
    mockReadBody.mockResolvedValue({ filename: '../../secret.journal' })
    await expect(activate(fakeEvent)).rejects.toMatchObject({ statusCode: 400 })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('returns 404 when an allowed journal does not exist', async () => {
    mockExistsSync.mockReturnValue(false)
    mockReadBody.mockResolvedValue({ filename: join(JOURNALS_DIR, 'budget.journal') })
    await expect(activate(fakeEvent)).rejects.toMatchObject({ statusCode: 404 })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('activates a managed journal (full path, as /list emits) and persists the choice', async () => {
    const full = join(JOURNALS_DIR, 'budget.journal')
    mockReadBody.mockResolvedValue({ filename: full })
    const res = await activate(fakeEvent)
    expect(res).toMatchObject({ success: true, path: full })
    const [cfgPath, contents] = mockWriteFile.mock.calls[0]!
    expect(cfgPath).toBe(ACTIVE_JOURNAL_CONFIG)
    expect(JSON.parse(contents).path).toBe(full)
  })

  it('allows the bundled sample journal', async () => {
    mockReadBody.mockResolvedValue({ filename: SAMPLE_JOURNAL })
    const res = await activate(fakeEvent)
    expect(res).toMatchObject({ success: true, path: resolve(SAMPLE_JOURNAL) })
    expect(JSON.parse(mockWriteFile.mock.calls[0]![1]).path).toBe(resolve(SAMPLE_JOURNAL))
  })
})
