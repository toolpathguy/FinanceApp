import { clearStoredApiKey, maskApiKey } from '../../utils/aiConfig'
import { resolveApiKey, getApiKeySource } from '../../utils/anthropic'

/**
 * DELETE /api/ai/config — remove the stored Anthropic API key. Any
 * `ANTHROPIC_API_KEY` env var is left intact (and still wins), so the response
 * reflects whatever key remains in effect afterward.
 */
export default defineEventHandler(async () => {
  await clearStoredApiKey()
  const key = resolveApiKey()
  return {
    configured: Boolean(key),
    source: getApiKeySource(),
    maskedKey: key ? maskApiKey(key) : null,
  }
})
