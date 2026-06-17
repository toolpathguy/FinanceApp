# Design — AI Budgeting Chat (Human-in-the-Loop)

## Introduction

Implements **GitHub Issue #8** (`toolpathguy/FinanceApp`): a chat assistant that
helps the user budget. The assistant reads live budget state through tools and
**proposes** envelope assignments / transfers; the user approves each proposed
action before anything is written. The model never moves money on its own — the
only code path that touches the journal is the existing
`POST /api/budget/assign` / `POST /api/budget/transfer` endpoints, invoked by the
client **after explicit user approval**.

This is the foundation feature: it introduces the shared Anthropic client and the
**propose → approve → commit** spine that the CSV-import feature (#9) reuses.

It respects `separation-of-concerns.md`: **no new accounting logic.** The model
reads structured state via tools that delegate to existing `server/utils`, and
the assistant only ever proposes calls to endpoints that already exist.

### Non-negotiable safety invariant

> **The tool loop never writes to the journal.** Proposed-action tools
> (`assign_to_envelope`, `transfer_between_envelopes`) are *surfaced*, never
> *executed*, by the server. A real write happens only when the client calls the
> existing assign/transfer endpoint after the user clicks Approve. This is
> covered by a dedicated test (R from requirements.md).

---

## Stack / dependencies

- **New dep:** `@anthropic-ai/sdk` (the official SDK; the one supported path for
  Node/Nitro).
- **Model:** `claude-opus-4-8`, **adaptive thinking** (`thinking: {type:
  "adaptive"}`), `output_config: { effort: "medium" }` (tunable — chat favors
  latency; bump to `high` if reasoning quality needs it). No `temperature` /
  `top_p` / `budget_tokens` (all removed on Opus 4.8 — sending them 400s).
- **Non-streaming** for v1 (`max_tokens: 4096`). Budget-chat replies are short and
  well under the SDK HTTP-timeout threshold; non-streaming keeps the HITL tool
  loop simple and fully testable. Streaming is a deferred enhancement (see
  Alternatives).
- **API key:** resolved in `server/utils/anthropic.ts` with **env override →
  in-app stored key**: `process.env.ANTHROPIC_API_KEY` first, else a key the user
  saves on the Settings page (persisted to gitignored `config/ai-config.json`,
  same pattern as `config/active-journal.json`). No `nuxt.config.ts` change
  (config stays hands-off per coding-standards). See **Decision: in-app key
  config** below.
- **UI:** Nuxt UI v4 chat suite — `UChatMessages`, `UChatMessage`, `UChatPrompt`,
  `UChatPromptSubmit` — plus a `UCard`-based proposed-action card with
  Approve / Reject buttons.

---

## Architecture & data flow

```
components/AiChatPanel.vue ─┐
  (UChat* + proposal card)  │  approve →  composables/useBudget assign/transfer
            │               │            (existing POST /api/budget/{assign,transfer})
            ▼               │                          │
composables/useAiChat.ts ───┘                          ▼
  $fetch('/api/ai/chat')  ◄──────────── reflect committed result back into chat
            │
            ▼
server/api/ai/chat.post.ts          ← holds the tool loop; NEVER writes the journal
   ├─ server/utils/anthropic.ts     ← shared SDK client + key (reused by #9)
   ├─ server/utils/aiTools.ts       ← tool defs + read-tool handlers (delegate down)
   ├─ server/ai/budgetInstructions.ts ← cached system prompt (YNAB rules, tone)
   └─ delegates reads to:
        server/utils/budgetReport.ts (extracted from budget.get.ts)
        server/utils/transactionList.ts (thin print wrapper)
```

The system prompt + tool definitions are the **stable, cacheable prefix**
(`cache_control: { type: "ephemeral" }`). Volatile budget state is **never** in
the prefix — it arrives through the `get_budget` tool, so the cache stays warm
across turns.

---

## The HITL tool loop (the crux)

`POST /api/ai/chat` runs a **manual** agentic loop (not the SDK tool runner — we
need to intercept proposed-action tools before they'd execute):

1. Client sends the full conversation `messages` (opaque Anthropic
   `MessageParam[]`, echoed verbatim each turn) plus, on a resume, the user's
   approve/reject `resolutions`.
2. Server calls `client.messages.create({ model, system, tools, messages, … })`.
3. On `stop_reason: "tool_use"`, inspect every `tool_use` block in the turn:
   - **Read tool** (`get_budget`, `get_transactions`): execute server-side via the
     `server/utils` delegate, collect a `tool_result`.
   - **Proposed-action tool** (`assign_to_envelope`, `transfer_between_envelopes`):
     **do not execute.** Record it as a pending proposal.
4. **If the turn contains no pending proposal:** append the assistant turn + the
   read `tool_result`s and loop (back to step 2), bounded by
   `MAX_TOOL_ITERATIONS = 8` (guards against runaway read loops).
5. **If the turn contains ≥1 pending proposal:** stop the loop and return to the
   client:
   ```ts
   {
     messages,           // updated history incl. this assistant turn (opaque)
     reply,              // assistant visible text for this turn
     proposedActions: ProposedAction[],   // awaiting approval
     readToolResults: ToolResultBlock[],  // results already computed for any
                                           // read tools in the SAME turn (echoed
                                           // back on resume so the protocol stays valid)
   }
   ```
6. Client renders the proposal card(s). On **Approve**, it calls the existing
   `POST /api/budget/assign` | `/transfer` with the proposal payload, then re-POSTs
   `/api/ai/chat` with `{ messages, resolutions }`. On **Reject**, it skips the
   write and re-POSTs with a reject resolution.
7. On resume, the server builds the user turn's `tool_result` blocks from
   `readToolResults` **+** the resolutions (`"Committed: <result>"` /
   `"User rejected this action"`), appends it, and resumes the loop at step 2.

This keeps the server **stateless** and the Anthropic protocol valid: every
`tool_use` block eventually receives a matching `tool_result` on the next request.

### Edge cases handled

- **New message while a proposal is pending:** the model is blocked waiting on
  `tool_result`s. The composable auto-resolves any un-acted proposal as rejected
  (`"Superseded by a new message"`) before sending the new user turn — otherwise
  the dangling `tool_use` 400s the API.
- **Mixed read + action in one turn:** the read results are computed and returned
  in `readToolResults`; the client echoes them back alongside the action verdict,
  so all `tool_use` blocks in the turn resolve together. (The system prompt also
  asks the model to propose actions in their own turn, which makes this rare.)
- **Multiple proposals in one turn:** all surfaced; each gets its own card and its
  own resolution. The loop resumes only once every proposal is resolved.
- **`stop_reason: "refusal"`:** return the refusal as assistant text; no actions.
- **Missing `ANTHROPIC_API_KEY`:** route returns 503 with a clear message; the
  panel shows a "configure your API key" empty state instead of a broken chat.
- **Iteration cap hit:** return what we have with a note; never loop forever.

---

## Tool surface (`server/utils/aiTools.ts`)

| Tool | Kind | Wraps | Returns / Effect |
|---|---|---|---|
| `get_budget` | read | `getBudgetReport(period?)` | Ready-to-Assign + envelope balances (Assigned/Activity/Available) |
| `get_transactions` | read | `getTransactionList({startDate?,endDate?,account?})` | recent transactions (date, payee, amount, account) |
| `assign_to_envelope` | **proposed action** | `POST /api/budget/assign` | proposal `{ date, physicalAccount, envelopes }` — HITL |
| `transfer_between_envelopes` | **proposed action** | `POST /api/budget/transfer` | proposal `{ date, sourceEnvelope, destinationEnvelope, amount }` — HITL |

- Tool `input_schema`s mirror the request bodies the endpoints already validate, so
  the existing server-side validation remains the real gate (amounts > 0, the
  Ready-to-Assign availability gate on assign, etc.). The model's proposal is just
  a suggestion; the endpoint still rejects an over-assignment.
- Read handlers are **pure delegations** — no accounting math in `aiTools.ts`.
- Tool definitions are frozen and ordered deterministically (cache-stable).

### Refactors to enable clean delegation (no behavior change)

- **Extract `server/utils/budgetReport.ts`** — move the report-building body of
  `budget.get.ts` into `getBudgetReport(period: string)`; the route becomes a thin
  validate-and-call wrapper. Both the route and `get_budget` call it. (Mirrors how
  `getReadyToAssign` was extracted to `budgetData.ts`.)
- **Add `server/utils/transactionList.ts`** — `getTransactionList(query)` runs
  `hledgerExec(['print', …])` + `transformTransactions` (existing utils) and shapes
  a compact list for the model. `transactions.get.ts` is left as-is (its
  register-row path is UI-specific); this is a small read helper, not a refactor of
  that route.

---

## Key interfaces / types (`types/ai.ts`)

```ts
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

export type ProposedAction =
  | { id: string; kind: 'assign'; summary: string; payload: AssignProposalPayload }
  | { id: string; kind: 'transfer'; summary: string; payload: TransferProposalPayload }

export interface ChatResolution {
  toolUseId: string
  status: 'approved' | 'rejected'
  resultText: string        // "Committed: …" or "User rejected this action"
}

// Wire types. `messages` is the opaque Anthropic MessageParam[] history; the
// client never renders it raw — it reads `reply` + `proposedActions` each turn.
export interface AiChatRequest {
  messages: unknown[]              // Anthropic MessageParam[]; typed at the SDK boundary
  resolutions?: ChatResolution[]
}
export interface AiChatResponse {
  messages: unknown[]
  reply: string
  proposedActions: ProposedAction[]
  readToolResults: unknown[]       // Anthropic ToolResultBlockParam[]; echoed back on resume
}
```

`unknown[]` at the wire boundary is the validated trust boundary (cast to the
SDK's `MessageParam[]` inside `chat.post.ts`); no `any`.

---

## Files added / changed

| File | Change |
|---|---|
| `server/utils/anthropic.ts` (new) | shared SDK client; reads `ANTHROPIC_API_KEY`; `getAnthropic()` throws a typed `MissingApiKeyError` if unset |
| `server/utils/aiTools.ts` (new) | tool definitions (read + proposed-action), `READ_TOOL_HANDLERS`, kind classification |
| `server/ai/budgetInstructions.ts` (new) | `BUDGET_SYSTEM_PROMPT` (markdown string: YNAB Rule 1, envelope conventions, "propose, never execute", tone) |
| `server/utils/budgetReport.ts` (new) | `getBudgetReport(period)` extracted from `budget.get.ts` |
| `server/utils/transactionList.ts` (new) | `getTransactionList(query)` compact read helper |
| `server/api/ai/chat.post.ts` (new) | the HITL tool loop; returns `AiChatResponse`; 503 when key missing |
| `server/api/budget.get.ts` (edit) | delegate to `getBudgetReport` (thin wrapper) |
| `composables/useAiChat.ts` (new) | reactive chat state, send/approve/reject, pending-proposal handling |
| `components/AiChatPanel.vue` (new) | Nuxt UI chat panel + proposed-action card + egress notice + no-key empty state |
| `pages/budget.vue` (edit) | mount the chat panel (slideover/side panel on the budget page) |
| `types/ai.ts` (new) | wire + proposal types above |
| `package.json` | add `@anthropic-ai/sdk` |
| `AI-MAP.md` | new route/util/composable/page rows + AI quirks (main agent, after impl) |

---

## Data egress (must document prominently — Issue #8 risk note)

Budget/envelope data and the user's chat messages are sent to the Anthropic API —
the one external data flow in this app. No secrets are persisted (only
`ANTHROPIC_API_KEY` in env; no bank credentials). The chat panel shows a
**persistent, visible notice** ("Messages and budget data are sent to Anthropic to
generate replies") and this is captured as a requirement, not just a code comment.

---

## Decision: in-app key config (amendment — deviates from Issue #8)

Issue #8 framed the key as living **only** in env ("No secrets stored … only
`ANTHROPIC_API_KEY` in env"). In practice that left no in-app way to enable the
chat — the user had to set an env var and restart the server. **Decision (user-
approved):** add a Settings-page field that persists the key to gitignored
`config/ai-config.json`, read by `getAnthropic()`.

- **Why this is acceptable here:** single-user local app; `config/` is already
  gitignored; mirrors the existing `config/active-journal.json` precedent; an
  Anthropic key in a local config file is standard practice (cf. `~/.aws/credentials`,
  `gh` CLI). It is a much lower-sensitivity secret than the bank/OAuth tokens #8
  was contrasting against.
- **Resolution precedence:** env **overrides** stored, so a Docker/CI deployment
  can still pin the key via `ANTHROPIC_API_KEY`; a local user configures it in the
  UI. The client is rebuilt when the resolved key changes, so saving takes effect
  on the next request — **no restart**.
- **Secret hygiene:** the key is never logged and never returned in full — GET
  `/api/ai/config` returns only `{configured, source, maskedKey}` (last-4 mask).
- **Endpoints:** `GET/POST/DELETE /api/ai/config` (status / save / clear);
  `server/utils/aiConfig.ts` owns the file (sync guarded read like `activeJournal.ts`;
  async write/clear). Settings page gains an "AI Assistant" card; the chat panel's
  no-key empty state links to Settings.

## Alternatives considered

- **SDK tool runner (auto loop)** — rejected: it executes tool handlers
  automatically, which is exactly what must *not* happen for proposed-action tools.
  The manual loop is required to intercept them. (The docs explicitly recommend the
  manual loop for human-in-the-loop approval.)
- **Server-side conversation state / session store** — rejected: adds persistent
  state for no benefit. Echoing the opaque `messages` history round-trip keeps the
  server stateless (consistent with the rest of the app) and is the standard
  stateless-Messages-API pattern.
- **Streaming in v1** — deferred. Streaming + a paused HITL tool loop is more
  complex to get right and to test, and budget-chat replies are short. The wire
  contract (`AiChatResponse`) is unchanged by a later switch to SSE for the text
  delta; tool-pause semantics stay the same.
- **`server/ai/budget-instructions.md` read via `fs`** — rejected in favor of a
  `.ts` string export: a relative `.md` read is fragile under the Nitro production
  bundle (path resolution), and a `.ts` constant typechecks and bundles cleanly.
  The content stays markdown-formatted inside the string, so it remains
  human-editable.
- **Tools recompute balances themselves** — rejected: violates
  separation-of-concerns. Read tools delegate to `server/utils`; the engine
  (hledger) stays the single source of truth.
- **Config via `nuxt.config.ts` `runtimeConfig`** — avoided: reading
  `process.env.ANTHROPIC_API_KEY` directly in the server util matches the existing
  `LEDGER_FILE` precedent and keeps framework config untouched.

---

## Testing strategy (detail in tasks.md)

- **Load-bearing safety test:** drive the tool loop with a mocked Anthropic client
  that emits an `assign_to_envelope` `tool_use`; assert `appendTransaction` /
  the assign endpoint is **never** called and the response surfaces a
  `proposedAction` instead. The journal-writer mock must record zero calls.
- **Read-tool dispatch:** mock the SDK to call `get_budget`; assert the handler
  delegates to `getBudgetReport` and the result is fed back as a `tool_result`,
  loop continues to `end_turn`.
- **Resume path:** given `resolutions: [approved]`, assert a `tool_result` user
  turn is appended with the committed text and the loop resumes.
- **Pending-proposal supersede:** a new message with an un-acted proposal
  auto-rejects it (valid protocol, no dangling `tool_use`).
- **Missing key:** `GET`/`POST` with no `ANTHROPIC_API_KEY` → 503, clear message.
- **Iteration cap:** a mock that always calls a read tool stops at
  `MAX_TOOL_ITERATIONS`.
- **Refactor parity:** existing `budget.get.ts` tests still pass against the
  `getBudgetReport` delegate (no behavior change).
- Mock Nitro globals with `vi.stubGlobal()` per project convention; mock the
  Anthropic SDK (`any` allowed in tests). Full `npx vitest run` + `npx nuxi
  typecheck` clean at the end.

---

## Out of scope

- Streaming responses (deferred enhancement).
- CSV import (#9) — this feature only builds the shared Anthropic plumbing it
  reuses.
- Multi-user auth / per-user API keys (single-user local app).
- Persisting chat history across reloads.
- New envelope/category creation via chat (assign + transfer only for v1).
