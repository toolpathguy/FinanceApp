import type Anthropic from '@anthropic-ai/sdk'
import type { ProposedAction } from '../../types/ai'
import { getBudgetReport } from './budgetReport'
import { getTransactionList } from './transactionList'

/**
 * Tool surface for the AI budgeting chat (Issue #8).
 *
 * Two kinds:
 * - **Read tools** (`get_budget`, `get_transactions`): executed server-side by
 *   the chat route, delegating to existing `server/utils` (no accounting math
 *   here). Their results are fed back to the model.
 * - **Proposed-action tools** (`assign_to_envelope`, `transfer_between_envelopes`):
 *   NEVER executed here. The route surfaces them for human approval; only the
 *   existing assign/transfer endpoints (called after approval) write the journal.
 *
 * `TOOLS` is the stable, deterministically-ordered, cache-controlled prefix the
 * route passes to `messages.create` — keep ordering and content stable so the
 * prompt cache stays warm.
 */

export const READ_TOOL_NAMES = ['get_budget', 'get_transactions'] as const
export const PROPOSED_ACTION_TOOL_NAMES = ['assign_to_envelope', 'transfer_between_envelopes'] as const

export function isProposedActionTool(name: string): boolean {
  return (PROPOSED_ACTION_TOOL_NAMES as readonly string[]).includes(name)
}

/** Minimal shape of a model tool call we care about (subset of Anthropic.ToolUseBlock). */
interface ToolCall {
  id: string
  name: string
  input: unknown
}

// --- Read tool handlers (delegation only) ---

export const READ_TOOL_HANDLERS: Record<string, (input: any) => Promise<unknown>> = {
  get_budget: async (input) => {
    const period = typeof input?.period === 'string' ? input.period.trim() : ''
    return await getBudgetReport(period)
  },
  get_transactions: async (input) => {
    return await getTransactionList({
      startDate: typeof input?.startDate === 'string' ? input.startDate : undefined,
      endDate: typeof input?.endDate === 'string' ? input.endDate : undefined,
      account: typeof input?.account === 'string' ? input.account : undefined,
      limit: typeof input?.limit === 'number' ? input.limit : undefined,
    })
  },
}

// --- Proposed-action mapping (does NOT execute anything) ---

/** Strip a stray leading "expenses:" so an envelope key matches the budget sub-account name. */
function toEnvelopeKey(raw: string): string {
  return raw.trim().replace(/^expenses:/, '')
}

function friendly(key: string): string {
  return key.split(':').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' / ')
}

function fmt(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/**
 * Build a {@link ProposedAction} from a proposed-action tool call. Resolves the
 * budget host (the asset account that owns the `:budget:` tree) server-side so
 * the model only has to supply envelope keys + amounts, and builds the exact
 * payload the existing assign/transfer endpoints expect.
 *
 * This creates a *proposal* only — it never writes to the journal.
 */
export async function toProposedAction(call: ToolCall): Promise<ProposedAction> {
  const input = (call.input ?? {}) as Record<string, unknown>
  const budgetBase = await resolveBudgetBase()

  if (call.name === 'assign_to_envelope') {
    const rawEnvelopes = (input.envelopes ?? {}) as Record<string, unknown>
    const envelopes: Record<string, number> = {}
    for (const [k, v] of Object.entries(rawEnvelopes)) {
      if (typeof v === 'number') envelopes[toEnvelopeKey(k)] = v
    }
    const physicalAccount = typeof input.physicalAccount === 'string' && input.physicalAccount.trim()
      ? input.physicalAccount.trim()
      : budgetBase
    const summary = 'Assign ' + Object.entries(envelopes)
      .map(([k, v]) => `${fmt(v)} to ${friendly(k)}`)
      .join(', ')
    return {
      id: call.id,
      kind: 'assign',
      summary,
      // date filled in by the client at commit time (uses the user's local date).
      payload: { date: '', physicalAccount, envelopes },
    }
  }

  // transfer_between_envelopes
  const srcKey = toEnvelopeKey(String(input.sourceEnvelope ?? ''))
  const dstKey = toEnvelopeKey(String(input.destinationEnvelope ?? ''))
  const amount = typeof input.amount === 'number' ? input.amount : 0
  const summary = `Move ${fmt(amount)} from ${friendly(srcKey)} to ${friendly(dstKey)}`
  return {
    id: call.id,
    kind: 'transfer',
    summary,
    payload: {
      date: '',
      sourceEnvelope: `${budgetBase}:budget:${srcKey}`,
      destinationEnvelope: `${budgetBase}:budget:${dstKey}`,
      amount,
    },
  }
}

// --- Tool definitions (stable, cache-controlled prefix) ---

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_budget',
    description:
      'Read the current envelope budget: Ready-to-Assign plus each envelope\'s Assigned, Activity, and Available. Call this before stating any figure or proposing an assignment — never rely on numbers from earlier in the conversation.',
    input_schema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description: 'Optional hledger period (e.g. "2025-03", "this month"). Omit for all-time balances.',
        },
      },
    },
  },
  {
    name: 'get_transactions',
    description:
      'List recent transactions (date, payee, amount, account) to answer questions about spending history.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Optional start date, YYYY-MM-DD.' },
        endDate: { type: 'string', description: 'Optional end date, YYYY-MM-DD.' },
        account: { type: 'string', description: 'Optional account or envelope filter.' },
        limit: { type: 'integer', description: 'Max rows (default 50, most recent first).' },
      },
    },
  },
  {
    name: 'assign_to_envelope',
    description:
      'PROPOSE assigning Ready-to-Assign money into one or more envelopes. This creates a proposal the user must approve — it does NOT move money. Provide the envelope identifiers from get_budget (the part after "expenses:") and positive dollar amounts.',
    input_schema: {
      type: 'object',
      properties: {
        envelopes: {
          type: 'object',
          description: 'Map of envelope identifier (e.g. "rent", "food:groceries") to a positive dollar amount.',
          additionalProperties: { type: 'number' },
        },
      },
      required: ['envelopes'],
    },
  },
  {
    name: 'transfer_between_envelopes',
    description:
      'PROPOSE moving money from one envelope to another. This creates a proposal the user must approve — it does NOT move money. Use envelope identifiers from get_budget.',
    input_schema: {
      type: 'object',
      properties: {
        sourceEnvelope: { type: 'string', description: 'Envelope to move money from (e.g. "dining").' },
        destinationEnvelope: { type: 'string', description: 'Envelope to move money into (e.g. "food:groceries").' },
        amount: { type: 'number', description: 'Positive dollar amount to move.' },
      },
      required: ['sourceEnvelope', 'destinationEnvelope', 'amount'],
    },
    // Cache breakpoint on the last (stable) tool definition: caches tools + system.
    cache_control: { type: 'ephemeral' },
  },
]
