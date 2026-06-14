import { access } from 'node:fs/promises'

/**
 * Async existence check (Issue #4 item 5b).
 *
 * Replaces synchronous `existsSync` in request handlers, which blocks the event
 * loop. Resolves true if the path is accessible, false otherwise — never throws.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
