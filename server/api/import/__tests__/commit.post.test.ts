import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeDedupHash } from '../../../utils/importDedup'
import type { CommitRow } from '../../../../types/import'

const h = vi.hoisted(() => ({
  appendMock: vi.fn(),
  contextMock: vi.fn(),
  hashesMock: vi.fn(),
}))

vi.mock('../../../utils/importContext', () => ({ getImportContext: (...a: any[]) => h.contextMock(...a) }))
vi.mock('../../../utils/transactionWriter', () => ({ appendSimplifiedTransaction: (...a: any[]) => h.appendMock(...a) }))
// Keep real computeDedupHash; stub only the journal read.
vi.mock('../../../utils/importDedup', async (orig) => ({
  ...(await orig<typeof import('../../../utils/importDedup')>()),
  loadJournalHashes: (...a: any[]) => h.hashesMock(...a),
}))

vi.stubGlobal('defineEventHandler', (fn: Function) => fn)
vi.stubGlobal('readBody', async (event: any) => event.body)

const { default: commit } = await import('../commit.post')

const ev = (rows: CommitRow[]) => ({ body: { rows } } as any)
const row = (over: Partial<CommitRow> = {}): CommitRow => ({
  date: '2026-06-17', payee: 'Store', amount: 40, direction: 'outflow',
  account: 'assets:checking', envelope: 'food:groceries', dedupHash: '', ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.contextMock.mockResolvedValue({ accounts: ['assets:checking'], envelopes: ['food:groceries'] })
  h.hashesMock.mockResolvedValue(new Set())
  h.appendMock.mockResolvedValue(undefined)
})

describe('POST /api/import/commit', () => {
  it('commits valid approved rows via the shared writer', async () => {
    const res = await commit(ev([row(), row({ payee: 'Cafe', amount: 5 })]))
    expect(res.committed).toBe(2)
    expect(h.appendMock).toHaveBeenCalledTimes(2)
    expect(res.failed).toHaveLength(0)
  })

  it('rejects an outflow with no envelope (R3.3) without blocking the valid rows (R4.2)', async () => {
    const res = await commit(ev([row({ envelope: '' }), row({ payee: 'OK' })]))
    expect(res.committed).toBe(1)
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0]!.error).toMatch(/envelope/i)
  })

  it('commits an inflow with no envelope as income → Ready to Assign (R3.4)', async () => {
    const res = await commit(ev([row({ direction: 'inflow', envelope: '', payee: 'Refund' })]))
    expect(res.committed).toBe(1)
    const sent = h.appendMock.mock.calls[0]![0]
    expect(sent.type).toBe('income')
    expect(sent.category).toBe('income:uncategorized')
  })

  it('skips a row whose hash already exists in the journal (R5.3)', async () => {
    const existing = computeDedupHash({ date: '2026-06-17', amount: 40, payee: 'Store' })
    h.hashesMock.mockResolvedValue(new Set([existing]))
    const res = await commit(ev([row()]))
    expect(res.committed).toBe(0)
    expect(res.skippedDuplicates).toHaveLength(1)
    expect(h.appendMock).not.toHaveBeenCalled()
  })

  it('commits two identical in-batch rows as distinct (R5.4)', async () => {
    const res = await commit(ev([row(), row()]))
    expect(res.committed).toBe(2)
    expect(res.skippedDuplicates).toHaveLength(0)
  })

  it('rejects an unknown account', async () => {
    const res = await commit(ev([row({ account: 'assets:nope' })]))
    expect(res.committed).toBe(0)
    expect(res.failed[0]!.error).toMatch(/account/i)
  })

  it('reports a writer failure as a failed row, not a thrown 500', async () => {
    h.appendMock.mockRejectedValueOnce(new Error('unbalanced'))
    const res = await commit(ev([row()]))
    expect(res.committed).toBe(0)
    expect(res.failed[0]!.error).toMatch(/unbalanced/)
  })
})
