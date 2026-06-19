import { getAnthropic, MissingApiKeyError, REQUEST_DEFAULTS } from '../../utils/anthropic'
import { getImportContext } from '../../utils/importContext'
import { loadJournalHashes } from '../../utils/importDedup'
import {
  IMPORT_SYSTEM_PROMPT, IMPORT_SCHEMA, MAX_IMPORT_ROWS, normalizeProposals,
} from '../../utils/importParse'
import type { ImportParseResponse } from '../../../types/import'

/**
 * POST /api/import/parse — turn an uploaded CSV into proposed transactions (Issue #9).
 *
 * SAFETY INVARIANT: this route NEVER writes to the journal. It reads the account
 * list, calls Anthropic with a structured-output (json_schema) request, and
 * returns normalized proposals for the user to review. Writes happen only in
 * commit.post.ts, only for approved rows. (Guarded by parse.post.test.ts.)
 */

interface ParseBody {
  csv?: unknown
}

export default defineEventHandler(async (event): Promise<ImportParseResponse> => {
  const body = await readBody<ParseBody>(event)
  const csv = typeof body.csv === 'string' ? body.csv : ''
  if (!csv.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'No CSV content provided.' })
  }

  // Bound output size: cap the number of data rows (one header row assumed).
  const nonEmptyLines = csv.split(/\r?\n/).filter(l => l.trim()).length
  if (nonEmptyLines - 1 > MAX_IMPORT_ROWS) {
    throw createError({
      statusCode: 413,
      statusMessage: `CSV has too many rows (max ${MAX_IMPORT_ROWS}). Please split the file and import in batches.`,
    })
  }

  let client
  try {
    client = getAnthropic()
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      throw createError({
        statusCode: 503,
        statusMessage: 'AI import is not configured. Set your Anthropic API key in Settings to enable it.',
      })
    }
    throw err
  }

  // Ground the model's suggestions in real targets; also feeds the review dropdowns.
  const context = await getImportContext()

  const userMessage = [
    'Valid real accounts (use exactly one of these or ""):',
    context.accounts.join('\n') || '(none)',
    '',
    'Valid envelope keys (use exactly one of these or ""):',
    context.envelopes.join('\n') || '(none)',
    '',
    'CSV to convert:',
    csv,
  ].join('\n')

  let parsed: unknown
  try {
    const response = await client.messages.parse({
      ...REQUEST_DEFAULTS,
      // Override the chat default (4096): proposal arrays can be large; non-streaming
      // stays well under the SDK HTTP-timeout threshold at this size with the row cap.
      max_tokens: 16000,
      output_config: { ...REQUEST_DEFAULTS.output_config, format: { type: 'json_schema', schema: IMPORT_SCHEMA } },
      system: [{ type: 'text', text: IMPORT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    })

    if (response.stop_reason === 'refusal') {
      throw createError({
        statusCode: 422,
        statusMessage: 'The assistant declined to process this file. Please check its contents and try again.',
      })
    }
    parsed = response.parsed_output
  } catch (err) {
    // Re-throw our own createError (it carries a statusCode); wrap SDK/network failures.
    if ((err as { statusCode?: number })?.statusCode) throw err
    const status = (err as { status?: number })?.status
    const message = (err as { message?: string })?.message ?? 'unknown error'
    const name = (err as { name?: string })?.name ?? 'Error'
    // Log structure/transport only — never the CSV contents or the key (R8.2).
    console.error(`[import/parse] Anthropic request failed: ${name}${status ? ` (status ${status})` : ''}: ${message}`)

    let statusMessage = 'Could not reach the assistant. Please try again.'
    if (/credit balance|billing|quota/i.test(message)) statusMessage = 'Your Anthropic account is out of credits. Add credits in the Anthropic Console, then try again.'
    else if (status === 401) statusMessage = 'The Anthropic API key was rejected. Check it in Settings.'
    else if (status === 403) statusMessage = 'This Anthropic API key is not permitted to use this model. Check it in Settings.'
    else if (status === 429) statusMessage = 'Anthropic is rate-limiting requests — please wait a moment and try again.'
    throw createError({ statusCode: 502, statusMessage })
  }

  const journalHashes = await loadJournalHashes()
  const { proposals, droppedRows } = normalizeProposals(parsed, context, journalHashes)

  return { proposals, context, droppedRows }
})
