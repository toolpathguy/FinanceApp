# Requirements — AI Budgeting Chat (Human-in-the-Loop)

Traces to **GitHub Issue #8**. Acceptance criteria use EARS form
(WHEN … THE SYSTEM SHALL …). Each requirement is testable; the test mapping lives
in `tasks.md`.

---

## R1 — Conversational budget Q&A

**User story:** As a budgeter, I want to ask questions about my budget in plain
language so I can understand my envelopes without reading tables.

- R1.1 — WHEN the user sends a message, THE SYSTEM SHALL call `claude-opus-4-8`
  with the budgeting system prompt and the conversation history, and return the
  assistant's reply text.
- R1.2 — WHEN the assistant needs current budget state, THE SYSTEM SHALL expose a
  `get_budget` tool that returns Ready-to-Assign and per-envelope
  Assigned/Activity/Available, computed by the existing budget logic.
- R1.3 — WHEN the assistant needs transaction history, THE SYSTEM SHALL expose a
  `get_transactions` tool returning a compact list (date, payee, amount, account).
- R1.4 — WHEN a read tool is called, THE SYSTEM SHALL execute it server-side,
  feed the result back to the model, and continue until the model produces a final
  reply — bounded by `MAX_TOOL_ITERATIONS` (8).
- R1.5 — THE SYSTEM SHALL NOT recompute any balance, Ready-to-Assign, or delta in
  chat code; read tools delegate to `server/utils` (hledger remains the source of
  truth).

## R2 — Human-in-the-loop proposed actions (safety-critical)

**User story:** As a budgeter, I want the assistant to suggest assignments and
transfers that I approve before anything changes, so the AI never moves my money
on its own.

- R2.1 — WHEN the assistant decides to assign or transfer, THE SYSTEM SHALL
  surface it as a **proposed action** (`assign_to_envelope` /
  `transfer_between_envelopes`) with a human-readable summary and the payload.
- R2.2 — WHEN a proposed-action tool is emitted by the model, THE SYSTEM SHALL NOT
  execute it and SHALL NOT write to the journal. *(Load-bearing — see R6.)*
- R2.3 — WHEN the user approves a proposed action, THE SYSTEM SHALL commit it by
  calling the existing `POST /api/budget/assign` or `POST /api/budget/transfer`
  endpoint with the proposal payload.
- R2.4 — WHEN the user rejects a proposed action, THE SYSTEM SHALL NOT write
  anything and SHALL inform the model the action was rejected.
- R2.5 — WHEN a commit endpoint rejects the request (e.g. the assign
  availability gate, non-positive amount), THE SYSTEM SHALL surface the error in
  the chat and SHALL NOT mark the action committed.
- R2.6 — WHEN an action is committed, THE SYSTEM SHALL reflect the result back to
  the model so the conversation stays consistent, and the budget view SHALL
  refresh to show the change.

## R3 — Conversation protocol integrity

**User story:** As a developer, I want the chat to stay stateless and protocol-valid
so it never wedges the API.

- R3.1 — THE SYSTEM SHALL be stateless: the full conversation history is passed
  from the client each request and echoed back unchanged.
- R3.2 — WHEN a turn contains tool calls, THE SYSTEM SHALL ensure every `tool_use`
  block receives a matching `tool_result` before the next assistant turn.
- R3.3 — WHEN read tools and a proposed action occur in the same turn, THE SYSTEM
  SHALL compute the read results, return them with the proposal, and resume only
  once all `tool_use` blocks in that turn are resolved.
- R3.4 — WHEN the user sends a new message while a proposal is still un-acted, THE
  SYSTEM SHALL auto-resolve the pending proposal as rejected before processing the
  new message (no dangling `tool_use`).

## R4 — Configuration & failure handling

- R4.1 — THE SYSTEM SHALL resolve the Anthropic API key as
  `process.env.ANTHROPIC_API_KEY` (override) else the in-app stored key (see R7);
  no `nuxt.config.ts` change.
- R4.2 — WHEN no key is configured (neither env nor stored), THE SYSTEM SHALL
  return HTTP 503 with a clear message, and the chat panel SHALL show a "configure
  your API key" empty state (linking to Settings) rather than erroring.
- R4.3 — WHEN the model returns `stop_reason: "refusal"`, THE SYSTEM SHALL return
  the refusal as assistant text with no proposed actions.
- R4.4 — WHEN `MAX_TOOL_ITERATIONS` is reached, THE SYSTEM SHALL return the
  partial result with a note and SHALL NOT loop indefinitely.
- R4.5 — WHEN the Anthropic call fails (network/5xx after SDK retries), THE SYSTEM
  SHALL surface a friendly error in the chat and leave the conversation resumable.

## R5 — Data egress transparency

- R5.1 — THE SYSTEM SHALL display a persistent, visible notice in the chat panel
  that messages and budget data are sent to the Anthropic API to generate replies.
- R5.2 — THE SYSTEM SHALL NOT persist the API key anywhere except the environment,
  and SHALL NOT log message content or the key.

## R6 — Verifiable HITL guarantee (test requirement)

- R6.1 — A test SHALL drive the tool loop with a mocked Anthropic client emitting
  an `assign_to_envelope` `tool_use` and assert the journal writer / assign
  endpoint is called **zero** times and a `proposedAction` is returned instead.
- R6.2 — A test SHALL assert the resume path commits only via the existing endpoint
  after an `approved` resolution.

---

## R7 — In-app API-key configuration (amendment)

**User story:** As a user, I want to set my Anthropic API key in the app so I can
enable the chat without editing environment variables or restarting the server.

- R7.1 — THE SYSTEM SHALL let the user save an API key from the Settings page,
  persisted to gitignored `config/ai-config.json`.
- R7.2 — WHEN a key is saved, THE SYSTEM SHALL use it on the next request without a
  server restart (the client is rebuilt when the resolved key changes).
- R7.3 — `process.env.ANTHROPIC_API_KEY` SHALL take precedence over the stored key.
- R7.4 — THE SYSTEM SHALL NEVER return the API key in full from any endpoint — only
  a masked form (last 4 chars) — and SHALL NEVER log it (extends R5.2).
- R7.5 — WHEN saving, THE SYSTEM SHALL reject an empty, whitespace-only,
  whitespace-containing, or too-short key with HTTP 400 and SHALL NOT persist it.
- R7.6 — WHEN the user clears the stored key, THE SYSTEM SHALL remove it but leave
  any `ANTHROPIC_API_KEY` env var intact, and report the resulting state.
- R7.7 — THE SETTINGS UI SHALL show whether a key is configured and its source,
  and SHALL indicate when an env var overrides a stored key.

## Non-functional requirements

- **NFR1 — Separation of concerns:** chat route = HTTP glue + tool loop; read
  tools delegate to `server/utils`; no accounting math in chat/AI code; the panel
  fetches only through `composables/useAiChat`.
- **NFR2 — Prompt caching:** system prompt + tool definitions form a stable,
  deterministically-ordered, `cache_control: ephemeral` prefix; volatile budget
  state is fetched via `get_budget`, never embedded in the prefix.
- **NFR3 — Type safety:** no `any`/unnecessary `as` in source; the opaque
  Anthropic history is cast to `MessageParam[]` only at the validated SDK
  boundary. (`any` allowed in tests for mocking.)
- **NFR4 — Windows/CRLF & money:** read tools reuse existing utils, inheriting
  CRLF-safe parsing and integer-cent handling; no new parsing paths.
- **NFR5 — Verification:** `npx vitest run` and `npx nuxi typecheck` both clean.
- **NFR6 — Map upkeep:** `AI-MAP.md` updated by the main agent after implementation.

## Out of scope

- Streaming responses (deferred; wire contract unchanged by a later SSE switch).
- CSV import (#9).
- Multi-user auth / per-user keys.
- Persisting chat history across reloads.
- Creating new envelopes/categories via chat (assign + transfer only for v1).
