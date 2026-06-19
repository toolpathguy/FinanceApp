import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Hoisted mock state ---
const h = vi.hoisted(() => ({
  parseMock: vi.fn(),
  appendMock: vi.fn(),
  contextMock: vi.fn(),
  hashesMock: vi.fn(),
  state: { keyConfigured: true },
}))

class FakeMissingApiKeyError extends Error {}

vi.mock('../../../utils/anthropic', () => ({
  getAnthropic: () => {
    if (!h.state.keyConfigured) throw new FakeMissingApiKeyError()
    return { messages: { parse: h.parseMock } }
  },
  MissingApiKeyError: FakeMissingApiKeyError,
  REQUEST_DEFAULTS: { model: 'claude-opus-4-8', max_tokens: 4096, output_config: { effort: 'medium' } },
}))

vi.mock('../../../utils/importContext', () => ({ getImportContext: (...a: any[]) => h.contextMock(...a) }))
// Keep the real computeDedupHash (normalizeProposals needs it); stub only the journal read.
vi.mock('../../../utils/importDedup', async (orig) => ({
  ...(await orig<typeof import('../../../utils/importDedup')>()),
  loadJournalHashes: (...a: any[]) => h.hashesMock(...a),
}))
// The journal writer — proving parse NEVER writes (R2.1). The graph must not reach it.
vi.mock('../../../utils/journalWriter', () => ({ appendTransaction: (...a: any[]) => h.appendMock(...a) }))

vi.stubGlobal('defineEventHandler', (fn: Function) => fn)
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('createError', (opts: any) => Object.assign(new Error(opts.statusMessage || opts.message), opts))

const { default: parse } = await import('../parse.post')

const ev = (body: any) => ({ body } as any)

beforeEach(() => {
  vi.clearAllMocks()
  h.state.keyConfigured = true
  h.contextMock.mockResolvedValue({ accounts: ['assets:checking'], envelopes: ['rent'] })
  h.hashesMock.mockResolvedValue(new Set())
})

describe('POST /api/import/parse — safety (R2.1)', () => {
  it('returns proposals WITHOUT ever writing to the journal', async () => {
    h.parseMock.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      parsed_output: { transactions: [
        { date: '2026-06-17', payee: 'Rent Co', amount: 1200, direction: 'outflow',
          suggestedAccount: 'assets:checking', suggestedEnvelope: 'rent', sourceRow: '06/17/2026,Rent Co,-1200' },
      ] },
    })

    const res = await parse(ev({ csv: 'date,desc,amount\n06/17/2026,Rent Co,-1200' }))

    expect(h.appendMock).not.toHaveBeenCalled()
    expect(res.proposals).toHaveLength(1)
    expect(res.proposals[0]!.suggestedEnvelope).toBe('rent')
    expect(res.context.accounts).toEqual(['assets:checking'])
  })
})

describe('POST /api/import/parse — error handling', () => {
  it('returns 503 when no API key is configured', async () => {
    h.state.keyConfigured = false
    await expect(parse(ev({ csv: 'a,b\n1,2' }))).rejects.toMatchObject({ statusCode: 503 })
    expect(h.parseMock).not.toHaveBeenCalled()
  })

  it('rejects an empty CSV', async () => {
    await expect(parse(ev({ csv: '   ' }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a CSV over the row cap', async () => {
    const lines = ['header', ...Array.from({ length: 201 }, (_, i) => `row${i}`)].join('\n')
    await expect(parse(ev({ csv: lines }))).rejects.toMatchObject({ statusCode: 413 })
    expect(h.parseMock).not.toHaveBeenCalled()
  })

  it('maps a refusal to an actionable error, no proposals, no writes', async () => {
    h.parseMock.mockResolvedValueOnce({ stop_reason: 'refusal', parsed_output: null })
    await expect(parse(ev({ csv: 'a,b\n1,2' }))).rejects.toMatchObject({ statusCode: 422 })
    expect(h.appendMock).not.toHaveBeenCalled()
  })

  it('wraps an SDK/network failure as a 502 (no key leakage)', async () => {
    h.parseMock.mockRejectedValueOnce(Object.assign(new Error('network down'), { status: 500 }))
    await expect(parse(ev({ csv: 'a,b\n1,2' }))).rejects.toMatchObject({ statusCode: 502 })
  })
})
