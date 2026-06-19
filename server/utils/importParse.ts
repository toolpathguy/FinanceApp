import type { ImportProposal, ImportDirection, DroppedRow } from '../../types/import'
import { computeDedupHash } from './importDedup'

/**
 * Prompt, structured-output schema, and normalization for CSV import parsing
 * (Issue #9).
 *
 * The model performs a one-shot extraction: arbitrary CSV layout → a normalized
 * array of transactions. We use Anthropic structured outputs (json_schema), so
 * the SDK validates the response against IMPORT_SCHEMA and we get typed data
 * back. `normalizeProposals` is a pure function that re-validates every field
 * (dates, amounts, direction) and grounds the model's account/envelope
 * suggestions in the real targets — rows that fail validation are surfaced in
 * `droppedRows`, never silently discarded (R1.4).
 */

/** Max CSV rows per parse — bounds output tokens (non-streaming). */
export const MAX_IMPORT_ROWS = 200

export const IMPORT_SYSTEM_PROMPT = `You convert a bank/credit-card CSV export into normalized transactions for a budgeting app.

For EACH data row in the CSV (skip the header row and blank lines), emit one transaction with:
- date: the transaction date as ISO "YYYY-MM-DD". Infer the source format (MM/DD/YYYY, DD/MM/YYYY, "5 Jun 2026", etc.) and convert.
- payee: who was paid or who paid, from the description/merchant/memo column. Keep it human-readable; strip noise like reference numbers when obvious.
- amount: a POSITIVE number (the magnitude). Never negative.
- direction: "outflow" if money left the account (a debit/purchase/withdrawal), "inflow" if money came in (a credit/deposit/refund). Determine this from the sign, or from separate debit/credit columns, or from the wording.
- suggestedAccount: the best-matching real account from the provided list, or "" if unsure.
- suggestedEnvelope: the best-matching expense category (envelope) from the provided list for an outflow, or "" if unsure. Leave "" for inflows. Do not invent categories that are not in the list.
- sourceRow: the original CSV line, copied verbatim, so the user can verify your mapping.

Rules:
- Output every data row. If a row is malformed, still emit it with your best guess and the verbatim sourceRow.
- amount is always positive; the sign lives in direction.
- Only suggest accounts/envelopes that appear in the provided lists; otherwise use "".`

/**
 * JSON schema for structured outputs — model-returned fields only.
 * Typed as a plain record so it assigns to the SDK's `JSONOutputFormat.schema`
 * (`{ [key: string]: unknown }`) without a cast at the route boundary.
 */
export const IMPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: 'string', description: 'Transaction date, ISO YYYY-MM-DD.' },
          payee: { type: 'string', description: 'Human-readable payee/merchant.' },
          amount: { type: 'number', description: 'Positive magnitude.' },
          direction: { type: 'string', enum: ['inflow', 'outflow'] },
          suggestedAccount: { type: 'string', description: 'Real account from the list, or "".' },
          suggestedEnvelope: { type: 'string', description: 'Envelope key from the list, or "".' },
          sourceRow: { type: 'string', description: 'Verbatim original CSV line.' },
        },
        required: ['date', 'payee', 'amount', 'direction', 'suggestedAccount', 'suggestedEnvelope', 'sourceRow'],
      },
    },
  },
  required: ['transactions'],
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** True if (year, month, day) is a real calendar date. */
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/**
 * Normalize a date string to YYYY-MM-DD, or null if unparseable. Tolerates ISO,
 * slash formats (MM/DD/YYYY US default; DD/MM when the first part is > 12), and
 * "D Mon YYYY". A safety net over the model's ISO output (R6.1).
 */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim()

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return isRealDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null
  }

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (m) {
    const a = Number(m[1]); const b = Number(m[2]); const y = Number(m[3])
    // a/b ambiguous: if a > 12 it must be the day (DD/MM), else assume MM/DD (US).
    const [mo, d] = a > 12 ? [b, a] : [a, b]
    return isRealDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null
  }

  m = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/.exec(s)
  if (m) {
    const d = Number(m[1]); const mo = MONTHS[m[2]!.slice(0, 3).toLowerCase()]; const y = Number(m[3])
    return mo && isRealDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null
  }

  return null
}

/** A single transaction object as returned by the model (pre-validation). */
interface RawTransaction {
  date?: unknown
  payee?: unknown
  amount?: unknown
  direction?: unknown
  suggestedAccount?: unknown
  suggestedEnvelope?: unknown
  sourceRow?: unknown
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * Re-validate and enrich the model's transactions into ImportProposals.
 *
 * Pure: no I/O. Rejected rows go to `droppedRows` with a reason. The model's
 * account/envelope suggestions are kept only if they match a real target.
 */
export function normalizeProposals(
  raw: unknown,
  context: { accounts: string[]; envelopes: string[] },
  journalHashes: Set<string>,
): { proposals: ImportProposal[]; droppedRows: DroppedRow[] } {
  const accountSet = new Set(context.accounts)
  const envelopeSet = new Set(context.envelopes)
  const list: RawTransaction[] = Array.isArray((raw as { transactions?: unknown })?.transactions)
    ? (raw as { transactions: RawTransaction[] }).transactions
    : []

  const proposals: ImportProposal[] = []
  const droppedRows: DroppedRow[] = []

  list.forEach((row, i) => {
    const sourceRow = asString(row.sourceRow)

    const date = normalizeDate(asString(row.date))
    if (!date) {
      droppedRows.push({ sourceRow, reason: `Unrecognized date: "${asString(row.date)}"` })
      return
    }

    const amountNum = typeof row.amount === 'number' ? row.amount : Number(asString(row.amount))
    const amount = Math.abs(amountNum)
    if (!Number.isFinite(amount) || amount <= 0) {
      droppedRows.push({ sourceRow, reason: `Invalid amount: "${asString(row.amount)}"` })
      return
    }

    const direction = row.direction === 'inflow' || row.direction === 'outflow'
      ? (row.direction as ImportDirection)
      : null
    if (!direction) {
      droppedRows.push({ sourceRow, reason: `Invalid direction: "${asString(row.direction)}"` })
      return
    }

    const suggestedAccountRaw = asString(row.suggestedAccount).trim()
    const suggestedAccount = accountSet.has(suggestedAccountRaw) ? suggestedAccountRaw : ''

    const envKey = asString(row.suggestedEnvelope).trim().replace(/^expenses:/, '')
    const suggestedEnvelope = envelopeSet.has(envKey) ? envKey : ''

    const payee = asString(row.payee).trim()
    const dedupHash = computeDedupHash({ date, amount, payee })

    proposals.push({
      id: String(i),
      date,
      payee,
      amount,
      direction,
      suggestedAccount,
      suggestedEnvelope,
      dedupHash,
      possibleDuplicate: journalHashes.has(dedupHash),
      sourceRow,
    })
  })

  return { proposals, droppedRows }
}
