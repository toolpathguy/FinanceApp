import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, MissingApiKeyError, REQUEST_DEFAULTS } from '../../utils/anthropic'
import { BUDGET_SYSTEM_PROMPT } from '../../ai/budgetInstructions'
import { TOOLS, READ_TOOL_HANDLERS, isProposedActionTool, toProposedAction } from '../../utils/aiTools'
import type { AiChatRequest, AiChatResponse, ProposedAction } from '../../../types/ai'

/**
 * POST /api/ai/chat — the human-in-the-loop budgeting chat tool loop (Issue #8).
 *
 * SAFETY INVARIANT: this route NEVER writes to the journal. Read tools execute
 * server-side and feed results back to the model; proposed-action tools
 * (assign/transfer) are SURFACED for user approval, never executed. A write
 * happens only when the client calls the existing assign/transfer endpoint after
 * the user approves. (Guarded by chat.post.test.ts.)
 *
 * Stateless: the full Anthropic message history is passed in and echoed back each
 * request. Every `tool_use` block eventually receives a matching `tool_result` —
 * read results immediately, proposed-action results on the resume turn — so the
 * conversation stays protocol-valid.
 */

const MAX_TOOL_ITERATIONS = 8

function isToolUse(block: Anthropic.ContentBlock): block is Anthropic.ToolUseBlock {
  return block.type === 'tool_use'
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()
}

function toolResult(toolUseId: string, value: unknown, isError = false): Anthropic.ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: typeof value === 'string' ? value : JSON.stringify(value ?? {}),
    is_error: isError,
  }
}

export default defineEventHandler(async (event): Promise<AiChatResponse> => {
  const body = await readBody<AiChatRequest>(event)

  let client: Anthropic
  try {
    client = getAnthropic()
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      throw createError({
        statusCode: 503,
        statusMessage: 'AI chat is not configured. Set ANTHROPIC_API_KEY to enable it.',
      })
    }
    throw err
  }

  // Validated trust boundary: the opaque wire history → Anthropic MessageParam[].
  const messages = (Array.isArray(body.messages) ? body.messages : []) as Anthropic.MessageParam[]

  // Resume turn: build the user turn that resolves the prior assistant turn's
  // tool_use blocks — read results computed last turn (echoed back) + the user's
  // approve/reject verdicts. Both kinds together so every tool_use is covered.
  if (body.resolutions?.length || body.readToolResults?.length) {
    const content: Anthropic.ToolResultBlockParam[] = [
      ...((body.readToolResults ?? []) as Anthropic.ToolResultBlockParam[]),
      ...(body.resolutions ?? []).map(r => toolResult(r.toolUseId, r.resultText)),
    ]
    if (content.length) messages.push({ role: 'user', content })
  }

  // Fresh user message.
  if (body.message && body.message.trim()) {
    messages.push({ role: 'user', content: body.message })
  }

  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: BUDGET_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
  ]

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.messages.create({
        ...REQUEST_DEFAULTS,
        system,
        tools: TOOLS,
        messages,
      })

      // Echo the assistant turn back into history (preserves thinking + tool_use
      // blocks, required for protocol-valid continuation on the same model).
      messages.push({ role: 'assistant', content: response.content })
      const reply = extractText(response.content)

      if (response.stop_reason === 'refusal') {
        return { messages, reply: reply || 'Sorry, I can\'t help with that.', proposedActions: [], readToolResults: [] }
      }

      if (response.stop_reason !== 'tool_use') {
        // end_turn / max_tokens / stop_sequence — a final reply.
        return { messages, reply, proposedActions: [], readToolResults: [] }
      }

      const toolUses = response.content.filter(isToolUse)
      const proposals = toolUses.filter(b => isProposedActionTool(b.name))
      const reads = toolUses.filter(b => !isProposedActionTool(b.name))

      if (proposals.length > 0) {
        // PAUSE: surface the proposal(s) for approval. Compute (but hold) results
        // for any read tools in this same turn so the client can echo them back
        // and resolve every tool_use together on resume. NOTHING is written.
        const readToolResults: Anthropic.ToolResultBlockParam[] = []
        for (const r of reads) {
          const result = await READ_TOOL_HANDLERS[r.name]?.(r.input)
          readToolResults.push(toolResult(r.id, result))
        }
        const proposedActions: ProposedAction[] = await Promise.all(proposals.map(toProposedAction))
        return { messages, reply, proposedActions, readToolResults }
      }

      // Read-only turn: execute, append results, and continue the loop.
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const r of reads) {
        try {
          const result = await READ_TOOL_HANDLERS[r.name]?.(r.input)
          results.push(toolResult(r.id, result))
        } catch (e) {
          results.push(toolResult(r.id, { error: (e as Error).message }, true))
        }
      }
      messages.push({ role: 'user', content: results })
    }

    // Iteration cap — return what we have rather than looping forever.
    return {
      messages,
      reply: 'I looked into that but it took more steps than expected — could you narrow the question?',
      proposedActions: [],
      readToolResults: [],
    }
  } catch (err) {
    // Anthropic/network failure after SDK retries. Leave the conversation
    // resumable and surface an actionable message rather than a 500.
    //
    // Log only the error name/status/message for diagnostics — these describe the
    // request *structure* or transport, never the budget data or the key (R5.2).
    const status: number | undefined = (err as { status?: number })?.status
    const name = (err as { name?: string })?.name ?? 'Error'
    const message = (err as { message?: string })?.message ?? 'unknown error'
    console.error(`[ai/chat] Anthropic request failed: ${name}${status ? ` (status ${status})` : ''}: ${message}`)

    // A billing/credit problem comes back as a 400 invalid_request_error — detect
    // it by message so we don't mislabel it as a malformed conversation.
    const isBilling = /credit balance|billing|quota/i.test(message)

    let reply = 'Sorry — I had trouble reaching the assistant just now. Please try again.'
    if (isBilling) reply = 'Your Anthropic account is out of credits. Add credits in the Anthropic Console (Plans & Billing), then try again.'
    else if (status === 401) reply = 'The Anthropic API key was rejected. Check or re-enter it in Settings.'
    else if (status === 403) reply = 'This Anthropic API key is not permitted to use this model. Check your key in Settings.'
    else if (status === 429) reply = 'Anthropic is rate-limiting requests — please wait a moment and try again.'
    else if (status === 400) reply = 'This conversation hit a snag and can\'t continue. Start a new chat to reset it.'

    return { messages, reply, proposedActions: [], readToolResults: [] }
  }
})
