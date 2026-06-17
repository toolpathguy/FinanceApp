// Wire + UI types for the AI budgeting chat (Issue #8).
//
// The Anthropic conversation history (`messages`) and the read-tool results
// crossing the wire are typed as `unknown[]` here so the client stays decoupled
// from the Anthropic SDK; `server/api/ai/chat.post.ts` casts them to the SDK's
// `MessageParam[]` / `ToolResultBlockParam[]` at its validated boundary. The
// client never renders the history raw — it reads `reply` + `proposedActions`.

export interface AssignProposalPayload {
  date: string
  physicalAccount: string
  envelopes: Record<string, number>
}

export interface TransferProposalPayload {
  date: string
  sourceEnvelope: string
  destinationEnvelope: string
  amount: number
}

/** A money-moving action the assistant proposes; committed only on user approval. */
export type ProposedAction =
  | { id: string; kind: 'assign'; summary: string; payload: AssignProposalPayload }
  | { id: string; kind: 'transfer'; summary: string; payload: TransferProposalPayload }

/** The user's decision on a proposed action, sent back to resume the tool loop. */
export interface ChatResolution {
  /** The `tool_use` id of the proposed action being resolved. */
  toolUseId: string
  status: 'approved' | 'rejected'
  /** Text fed back to the model, e.g. "Committed: …" or "User rejected this action". */
  resultText: string
}

export interface AiChatRequest {
  /** Opaque Anthropic MessageParam[] history; empty on the first turn. */
  messages: unknown[]
  /** Present on a resume turn: the user's verdicts on pending proposed actions. */
  resolutions?: ChatResolution[]
  /**
   * Read-tool results the server computed in the same turn as the pending
   * proposal (from {@link AiChatResponse.readToolResults}); echoed back on resume
   * so every `tool_use` in that turn resolves together. Anthropic
   * ToolResultBlockParam[].
   */
  readToolResults?: unknown[]
  /** The new user message text. Omitted on a pure resume (approve/reject only). */
  message?: string
}

export interface AiChatResponse {
  /** Updated opaque history; echo back verbatim on the next request. */
  messages: unknown[]
  /** Assistant's visible reply text for this turn. */
  reply: string
  /** Non-empty when the turn is awaiting approval of one or more actions. */
  proposedActions: ProposedAction[]
  /**
   * Anthropic ToolResultBlockParam[] already computed for read tools in the same
   * turn as a pending proposal; echoed back on resume so every `tool_use` block
   * resolves together and the protocol stays valid.
   */
  readToolResults: unknown[]
}

/** Local-only transcript entry the chat panel renders (never crosses the wire). */
export interface ChatDisplayMessage {
  role: 'user' | 'assistant'
  text: string
}
