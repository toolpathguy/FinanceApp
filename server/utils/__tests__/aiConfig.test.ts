import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

vi.mock('node:fs', () => ({ readFileSync: h.readFileSync }))
vi.mock('node:fs/promises', () => ({ writeFile: h.writeFile, mkdir: h.mkdir }))

const { readStoredApiKey, writeStoredApiKey, clearStoredApiKey, maskApiKey } = await import('../aiConfig')

beforeEach(() => {
  vi.clearAllMocks()
  h.writeFile.mockResolvedValue(undefined)
  h.mkdir.mockResolvedValue(undefined)
})

describe('readStoredApiKey', () => {
  it('returns the trimmed key when present', () => {
    h.readFileSync.mockReturnValue(JSON.stringify({ apiKey: '  sk-ant-abc123  ' }))
    expect(readStoredApiKey()).toBe('sk-ant-abc123')
  })

  it('returns undefined when the file is missing (read throws)', () => {
    h.readFileSync.mockImplementation(() => { throw new Error('ENOENT') })
    expect(readStoredApiKey()).toBeUndefined()
  })

  it('returns undefined for malformed JSON', () => {
    h.readFileSync.mockReturnValue('{not json')
    expect(readStoredApiKey()).toBeUndefined()
  })

  it('returns undefined when apiKey is empty/whitespace', () => {
    h.readFileSync.mockReturnValue(JSON.stringify({ apiKey: '   ' }))
    expect(readStoredApiKey()).toBeUndefined()
  })
})

describe('writeStoredApiKey', () => {
  it('ensures the config dir exists and writes the key', async () => {
    await writeStoredApiKey('sk-ant-xyz')
    expect(h.mkdir).toHaveBeenCalledWith('config', { recursive: true })
    expect(h.writeFile).toHaveBeenCalledOnce()
    const [path, contents] = h.writeFile.mock.calls[0]!
    expect(path).toBe('config/ai-config.json')
    expect(JSON.parse(contents as string)).toEqual({ apiKey: 'sk-ant-xyz' })
  })
})

describe('clearStoredApiKey', () => {
  it('writes an empty config (no key)', async () => {
    await clearStoredApiKey()
    const [, contents] = h.writeFile.mock.calls[0]!
    expect(JSON.parse(contents as string)).toEqual({})
  })
})

describe('maskApiKey', () => {
  it('shows only the last 4 characters', () => {
    expect(maskApiKey('sk-ant-abcdef1234')).toBe('••••••••1234')
  })

  it('fully masks short or empty keys (never exposes them)', () => {
    expect(maskApiKey('short')).toBe('••••••••')
    expect(maskApiKey('')).toBe('••••••••')
  })
})
