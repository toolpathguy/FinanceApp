import Anthropic from '@anthropic-ai/sdk'
import { readStoredApiKey } from './aiConfig'

/**
 * Shared Anthropic client + request defaults for the AI features (budgeting chat
 * #8, and CSV import #9 which reuses this module).
 *
 * The API key is resolved with the env var taking precedence over a key
 * configured in-app via the Settings page (persisted by `aiConfig.ts`):
 *
 *   process.env.ANTHROPIC_API_KEY  →  config/ai-config.json  →  none
 *
 * Env-first lets a Docker/CI deployment pin the key, while a local user can
 * configure it in the UI without touching the environment or restarting. The
 * key never leaves the server: only this module and the routes that import it
 * touch it, and it is never logged.
 */

/** Where the resolved key came from — surfaced to the Settings UI. */
export type ApiKeySource = 'env' | 'config' | 'none'

/** Resolve the active API key (env override → stored), or undefined if none. */
export function resolveApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim() || readStoredApiKey()
}

/** Where the active key comes from (for the Settings UI status line). */
export function getApiKeySource(): ApiKeySource {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return 'env'
  if (readStoredApiKey()) return 'config'
  return 'none'
}

/** Thrown when no API key is configured. Routes map this to a 503 + empty state. */
export class MissingApiKeyError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not set')
    this.name = 'MissingApiKeyError'
  }
}

/** The model for all AI features. Opus 4.8 — adaptive thinking, no sampling params. */
export const MODEL = 'claude-opus-4-8'

/**
 * Shared request defaults. Spread into `messages.create`.
 * - adaptive thinking: Opus 4.8 decides depth per turn (no `budget_tokens`).
 * - effort `medium`: chat favors latency; bump to `high` if reasoning needs it.
 * - `max_tokens` 4096: budget-chat replies are short; non-streaming stays well
 *   under the SDK HTTP-timeout threshold.
 */
export const REQUEST_DEFAULTS = {
  model: MODEL,
  max_tokens: 4096,
  thinking: { type: 'adaptive' as const },
  output_config: { effort: 'medium' as const },
}

let client: Anthropic | null = null

/**
 * Return the shared Anthropic client, constructing it on first use.
 * @throws {MissingApiKeyError} when no key is configured (neither env nor stored).
 */
export function getAnthropic(): Anthropic {
  const apiKey = resolveApiKey()
  if (!apiKey) throw new MissingApiKeyError()
  // Cache, but rebuild if the key changed — so saving a new key in the Settings
  // UI takes effect on the next request without a restart.
  if (!client || client.apiKey !== apiKey) {
    client = new Anthropic({ apiKey })
  }
  return client
}
