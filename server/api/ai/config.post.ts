import { writeStoredApiKey, maskApiKey } from '../../utils/aiConfig'
import { getApiKeySource } from '../../utils/anthropic'

interface SaveKeyRequest {
  apiKey?: unknown
}

/**
 * POST /api/ai/config — save the Anthropic API key entered in the Settings UI to
 * the gitignored config file. Takes effect on the next chat request (no restart).
 *
 * The key is validated but never logged or echoed back in full (only masked).
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<SaveKeyRequest>(event)
  const raw = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''

  if (!raw) {
    throw createError({ statusCode: 400, statusMessage: 'apiKey is required' })
  }
  // A key has no whitespace/newlines; reject paste artifacts rather than persist
  // a value that would fail at the API boundary.
  if (/\s/.test(raw)) {
    throw createError({ statusCode: 400, statusMessage: 'apiKey must not contain whitespace' })
  }
  if (raw.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'apiKey looks too short' })
  }

  await writeStoredApiKey(raw)

  // `source` reflects what's actually in effect: if ANTHROPIC_API_KEY is set, it
  // still overrides the stored key — tell the UI so it can say so.
  return {
    configured: true,
    source: getApiKeySource(),
    maskedKey: maskApiKey(raw),
  }
})
