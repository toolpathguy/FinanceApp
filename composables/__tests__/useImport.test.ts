import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { ImportParseResponse, ImportProposal, ImportCommitResponse } from '~/types/import'

// The composable uses auto-imported `ref` and `$fetch`.
vi.stubGlobal('ref', ref)
const fetchMock = vi.fn()
vi.stubGlobal('$fetch', (...args: any[]) => fetchMock(...args))

const { useImport } = await import('../useImport')

const proposal = (over: Partial<ImportProposal> = {}): ImportProposal => ({
  id: '0', date: '2026-06-17', payee: 'Store', amount: 40, direction: 'outflow',
  suggestedAccount: 'assets:checking', suggestedEnvelope: 'food:groceries',
  dedupHash: 'h0', possibleDuplicate: false, sourceRow: 'raw', ...over,
})

const parseRes = (proposals: ImportProposal[]): ImportParseResponse => ({
  proposals,
  context: { accounts: ['assets:checking'], envelopes: ['food:groceries'] },
  droppedRows: [],
})

beforeEach(() => fetchMock.mockReset())

describe('useImport.parse', () => {
  it('populates editable rows and pre-approves confident non-duplicate rows', async () => {
    fetchMock.mockResolvedValueOnce(parseRes([proposal()]))
    const imp = useImport()
    await imp.parse('date,desc,amt\n...', 'bank.csv')

    expect(imp.fileName.value).toBe('bank.csv')
    expect(imp.rows.value).toHaveLength(1)
    expect(imp.rows.value[0]!.account).toBe('assets:checking')
    expect(imp.rows.value[0]!.envelope).toBe('food:groceries')
    expect(imp.rows.value[0]!.approved).toBe(true)
  })

  it('does not pre-approve a possible duplicate or an outflow with no envelope', async () => {
    fetchMock.mockResolvedValueOnce(parseRes([
      proposal({ id: '0', possibleDuplicate: true }),
      proposal({ id: '1', suggestedEnvelope: '' }),
    ]))
    const imp = useImport()
    await imp.parse('x', 'f.csv')
    expect(imp.rows.value[0]!.approved).toBe(false) // duplicate
    expect(imp.rows.value[1]!.approved).toBe(false) // outflow without envelope
  })

  it('surfaces a 503 as not-configured', async () => {
    fetchMock.mockRejectedValueOnce({ statusCode: 503 })
    const imp = useImport()
    await imp.parse('x', 'f.csv')
    expect(imp.error.value).toBe('not-configured')
    expect(imp.rows.value).toHaveLength(0)
  })
})

describe('useImport.canApprove', () => {
  it('blocks an outflow with no envelope, allows an inflow with none', async () => {
    const imp = useImport()
    expect(imp.canApprove({ direction: 'outflow', envelope: '' } as any)).toBe(false)
    expect(imp.canApprove({ direction: 'outflow', envelope: 'rent' } as any)).toBe(true)
    expect(imp.canApprove({ direction: 'inflow', envelope: '' } as any)).toBe(true)
  })
})

describe('useImport.commit', () => {
  it('sends only approved+approvable rows and exposes the summary', async () => {
    fetchMock.mockResolvedValueOnce(parseRes([
      proposal({ id: '0' }),
      proposal({ id: '1', payee: 'Skip' }),
    ]))
    const onCommitted = vi.fn()
    const imp = useImport({ onCommitted })
    await imp.parse('x', 'f.csv')

    imp.rows.value[1]!.approved = false // user rejects the second row
    const summary: ImportCommitResponse = { committed: 1, skippedDuplicates: [], failed: [] }
    fetchMock.mockResolvedValueOnce(summary)

    await imp.commit()

    const body = fetchMock.mock.calls[1]![1].body.rows
    expect(body).toHaveLength(1)
    expect(body[0].payee).toBe('Store')
    expect(imp.result.value).toEqual(summary)
    expect(onCommitted).toHaveBeenCalledOnce()
  })

  it('refuses to commit when nothing is approved', async () => {
    const imp = useImport()
    await imp.commit()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(imp.error.value).toMatch(/approve at least one/i)
  })
})
