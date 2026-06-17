import { resolveApiKey, getApiKeySource } from '../../utils/anthropic'
import { maskApiKey, readStoredApiKey } from '../../utils/aiConfig'

/**
 * GET /api/ai/config — report whether the Anthropic API key is configured and
 * where it comes from, for the Settings UI status line.
 *
 * `hasStoredKey` is reported independently of `source` so the UI can still offer
 * to clear a stored key that's currently shadowed by an env var (otherwise a
 * dormant key on disk would be unclearable from the UI).
 *
 * NEVER returns the key in full — only a masked form (last 4 chars). The full
 * key never crosses the wire.
 */
export default defineEventHandler(() => {
  const key = resolveApiKey()
  const source = getApiKeySource()
  return {
    configured: Boolean(key),
    source,
    maskedKey: key ? maskApiKey(key) : null,
    hasStoredKey: Boolean(readStoredApiKey()),
  }
})
