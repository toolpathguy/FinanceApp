import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  resolveApiKey: vi.fn(),
  getApiKeySource: vi.fn(),
  writeStoredApiKey: vi.fn(),
  clearStoredApiKey: vi.fn(),
  readStoredApiKey: vi.fn(),
}))

vi.mock('../../../utils/anthropic', () => ({
  resolveApiKey: h.resolveApiKey,
  getApiKeySource: h.getApiKeySource,
}))
vi.mock('../../../utils/aiConfig', () => ({
  writeStoredApiKey: h.writeStoredApiKey,
  clearStoredApiKey: h.clearStoredApiKey,
  readStoredApiKey: h.readStoredApiKey,
  // Real-ish mask so we can assert the full key is never returned.
  maskApiKey: (k: string) => (k.length <= 8 ? '••••••••' : `••••••••${k.slice(-4)}`),
}))

vi.stubGlobal('defineEventHandler', (fn: Function) => fn)
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('createError', (opts: any) => Object.assign(new Error(opts.statusMessage || opts.message), opts))

const { default: getConfig } = await import('../config.get')
const { default: postConfig } = await import('../config.post')
const { default: deleteConfig } = await import('../config.delete')

const ev = (body?: any) => ({ body } as any)

beforeEach(() => {
  vi.clearAllMocks()
  h.writeStoredApiKey.mockResolvedValue(undefined)
  h.clearStoredApiKey.mockResolvedValue(undefined)
})

describe('GET /api/ai/config', () => {
  it('reports configured + source + masked key (never the full key)', () => {
    h.resolveApiKey.mockReturnValue('sk-ant-secret-7777')
    h.getApiKeySource.mockReturnValue('config')
    h.readStoredApiKey.mockReturnValue('sk-ant-secret-7777')
    const res = getConfig(ev()) as any
    expect(res).toEqual({ configured: true, source: 'config', maskedKey: '••••••••7777', hasStoredKey: true })
    expect(JSON.stringify(res)).not.toContain('secret')
  })

  it('reports not configured', () => {
    h.resolveApiKey.mockReturnValue(undefined)
    h.getApiKeySource.mockReturnValue('none')
    h.readStoredApiKey.mockReturnValue(undefined)
    expect(getConfig(ev())).toEqual({ configured: false, source: 'none', maskedKey: null, hasStoredKey: false })
  })

  it('reports a dormant stored key even when an env var overrides it', () => {
    // env wins → source 'env', resolved key is the env key, but a stored key
    // still exists on disk and must remain clearable from the UI.
    h.resolveApiKey.mockReturnValue('sk-env-1234')
    h.getApiKeySource.mockReturnValue('env')
    h.readStoredApiKey.mockReturnValue('sk-stored-9999')
    const res = getConfig(ev()) as any
    expect(res.source).toBe('env')
    expect(res.hasStoredKey).toBe(true)
  })
})

describe('POST /api/ai/config', () => {
  it('saves a valid key and returns only the masked form', async () => {
    h.getApiKeySource.mockReturnValue('config')
    const res = await postConfig(ev({ apiKey: '  sk-ant-abcdef1234  ' })) as any
    expect(h.writeStoredApiKey).toHaveBeenCalledWith('sk-ant-abcdef1234') // trimmed
    expect(res.configured).toBe(true)
    expect(res.maskedKey).toBe('••••••••1234')
    expect(JSON.stringify(res)).not.toContain('abcdef')
  })

  it('reflects env override in the reported source', async () => {
    h.getApiKeySource.mockReturnValue('env')
    const res = await postConfig(ev({ apiKey: 'sk-ant-abcdef1234' })) as any
    expect(res.source).toBe('env')
  })

  it.each([
    ['empty', { apiKey: '   ' }],
    ['missing', {}],
    ['whitespace inside', { apiKey: 'sk ant key' }],
    ['too short', { apiKey: 'sk-12' }],
  ])('rejects an invalid key (%s) with 400 and does not write', async (_label, body) => {
    await expect(postConfig(ev(body))).rejects.toMatchObject({ statusCode: 400 })
    expect(h.writeStoredApiKey).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/ai/config', () => {
  it('clears the stored key and reports the remaining state', async () => {
    h.resolveApiKey.mockReturnValue(undefined)
    h.getApiKeySource.mockReturnValue('none')
    const res = await deleteConfig(ev()) as any
    expect(h.clearStoredApiKey).toHaveBeenCalledOnce()
    expect(res).toEqual({ configured: false, source: 'none', maskedKey: null })
  })

  it('still reports configured when an env var remains after clearing', async () => {
    h.resolveApiKey.mockReturnValue('sk-env-9999')
    h.getApiKeySource.mockReturnValue('env')
    const res = await deleteConfig(ev()) as any
    expect(res.configured).toBe(true)
    expect(res.source).toBe('env')
  })
})
