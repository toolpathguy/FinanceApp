import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ readStored: vi.fn() }))
// The key resolution consults the stored config; mock it so tests don't depend
// on a real config/ai-config.json on disk.
vi.mock('../aiConfig', () => ({ readStoredApiKey: h.readStored }))

const { getAnthropic, MissingApiKeyError, MODEL, REQUEST_DEFAULTS, resolveApiKey, getApiKeySource } =
  await import('../anthropic')

const original = process.env.ANTHROPIC_API_KEY

beforeEach(() => {
  vi.clearAllMocks()
  h.readStored.mockReturnValue(undefined)
})

afterEach(() => {
  if (original !== undefined) process.env.ANTHROPIC_API_KEY = original
  else delete process.env.ANTHROPIC_API_KEY
})

describe('resolveApiKey precedence (env overrides stored)', () => {
  it('uses the env var when set, even if a stored key exists', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-env'
    h.readStored.mockReturnValue('sk-stored')
    expect(resolveApiKey()).toBe('sk-env')
    expect(getApiKeySource()).toBe('env')
  })

  it('falls back to the stored key when the env var is unset', () => {
    delete process.env.ANTHROPIC_API_KEY
    h.readStored.mockReturnValue('sk-stored')
    expect(resolveApiKey()).toBe('sk-stored')
    expect(getApiKeySource()).toBe('config')
  })

  it('reports none when neither is configured', () => {
    delete process.env.ANTHROPIC_API_KEY
    h.readStored.mockReturnValue(undefined)
    expect(resolveApiKey()).toBeUndefined()
    expect(getApiKeySource()).toBe('none')
  })
})

describe('getAnthropic', () => {
  it('throws MissingApiKeyError when neither env nor stored key is set', () => {
    delete process.env.ANTHROPIC_API_KEY
    h.readStored.mockReturnValue(undefined)
    expect(() => getAnthropic()).toThrow(MissingApiKeyError)
  })

  it('builds a client from the stored key when env is unset', () => {
    delete process.env.ANTHROPIC_API_KEY
    h.readStored.mockReturnValue('sk-stored')
    expect(getAnthropic().apiKey).toBe('sk-stored')
  })

  it('rebuilds the client when the resolved key changes (no restart needed)', () => {
    delete process.env.ANTHROPIC_API_KEY
    h.readStored.mockReturnValue('sk-a')
    const a = getAnthropic()
    h.readStored.mockReturnValue('sk-b')
    const b = getAnthropic()
    expect(b.apiKey).toBe('sk-b')
    expect(b).not.toBe(a)
  })
})

describe('request defaults', () => {
  it('targets Opus 4.8 with adaptive thinking and no sampling params', () => {
    expect(MODEL).toBe('claude-opus-4-8')
    expect(REQUEST_DEFAULTS.model).toBe('claude-opus-4-8')
    expect(REQUEST_DEFAULTS.thinking).toEqual({ type: 'adaptive' })
    expect(REQUEST_DEFAULTS).not.toHaveProperty('temperature')
    expect(REQUEST_DEFAULTS).not.toHaveProperty('top_p')
    expect(REQUEST_DEFAULTS.output_config).toEqual({ effort: 'medium' })
  })
})
