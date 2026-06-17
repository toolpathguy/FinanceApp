import { readFileSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'

/**
 * Persisted AI configuration (Issue #8): the Anthropic API key entered via the
 * Settings page. Stored in a small gitignored JSON file rather than process.env
 * so the user can configure the chat in-app, and the choice survives restart.
 * Mirrors the active-journal pattern (`activeJournal.ts`): this module owns
 * reading the file (sync, guarded, never throws — called from the synchronous
 * `getAnthropic`); the config endpoints own writing it (async).
 *
 * The stored key is a secret: it is NEVER logged and NEVER returned in full from
 * an API response (only a masked form via {@link maskApiKey}). `config/` is
 * gitignored, so the file is not committed.
 */

const AI_CONFIG_PATH = 'config/ai-config.json'
const CONFIG_DIR = 'config'

interface AiConfig {
  apiKey?: string
}

/**
 * Read the stored Anthropic API key, or undefined if absent/unreadable/empty.
 * Never throws.
 */
export function readStoredApiKey(): string | undefined {
  try {
    const raw = readFileSync(AI_CONFIG_PATH, 'utf-8')
    const key = (JSON.parse(raw) as AiConfig).apiKey
    if (typeof key === 'string' && key.trim()) return key.trim()
  } catch {
    // no/invalid config — caller falls back to env / none
  }
  return undefined
}

/** Persist the API key. Async — called from a request handler, not a hot path. */
export async function writeStoredApiKey(key: string): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(AI_CONFIG_PATH, JSON.stringify({ apiKey: key } satisfies AiConfig, null, 2), 'utf-8')
}

/** Remove the stored API key (writes an empty config; leaves any env var intact). */
export async function clearStoredApiKey(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(AI_CONFIG_PATH, JSON.stringify({} satisfies AiConfig, null, 2), 'utf-8')
}

/**
 * Mask a key for display: keep only the last 4 characters. Returns a fixed mask
 * for short/empty input so the full key is never exposed.
 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim()
  if (trimmed.length <= 8) return '••••••••'
  return `••••••••${trimmed.slice(-4)}`
}
