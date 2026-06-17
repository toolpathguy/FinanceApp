# Tasks — AI Budgeting Chat (Human-in-the-Loop)

Ordered, independently verifiable. Each task notes files, tests, and the
requirement(s) it covers. Implement one at a time; run the listed tests + mark
`- [x]` before moving on. Do not commit until I say so.

Convention: `*.test.ts` beside source; API tests under `server/**/__tests__/`;
mock Nitro globals with `vi.stubGlobal()`; `any` allowed in tests for SDK mocks.

---

- [x] **T1 — Dependency + shared Anthropic client**
  - Add `@anthropic-ai/sdk` to `package.json` (`npm install @anthropic-ai/sdk`).
  - New `server/utils/anthropic.ts`: `getAnthropic()` returns a singleton client
    reading `process.env.ANTHROPIC_API_KEY`; export `MissingApiKeyError`; export
    `MODEL = 'claude-opus-4-8'` and shared request defaults (adaptive thinking,
    `effort: 'medium'`, `max_tokens: 4096`).
  - **Tests** (`anthropic.test.ts`): `getAnthropic()` throws `MissingApiKeyError`
    when the env var is unset; returns a client when set (stub `process.env`).
  - **Covers:** R4.1, R4.2, NFR2 (defaults live here). _Verify:_ `vitest run server/utils/anthropic.test.ts`, typecheck.

- [x] **T2 — Extract `getBudgetReport` (refactor, no behavior change)**
  - New `server/utils/budgetReport.ts`: `getBudgetReport(period: string)` = the
    report-building body of `budget.get.ts`.
  - Edit `budget.get.ts` to validate the period then delegate to it (thin wrapper).
  - **Tests:** existing `budget.get` route tests must still pass; add a direct unit
    test for `getBudgetReport` (default + a period).
  - **Covers:** R1.2, R1.5, NFR1. _Verify:_ `vitest run` on the budget route + new test; typecheck.

- [x] **T3 — `getTransactionList` read helper**
  - New `server/utils/transactionList.ts`: `getTransactionList({startDate?,endDate?,account?})`
    → `hledgerExec(['print', …])` + `transformTransactions`, shaped to
    `{date, payee, amount, account}[]`. Reuse `isValidDate`/`isValidAccount`
    guards; pass account after `--`.
  - **Tests** (`transactionList.test.ts`): shaping + that invalid date/account are
    rejected; CRLF-safe (mock `hledgerExec`).
  - **Covers:** R1.3, R1.5, NFR4. _Verify:_ `vitest run server/utils/transactionList.test.ts`, typecheck.

- [x] **T4 — Wire types**
  - New `types/ai.ts`: `AssignProposalPayload`, `TransferProposalPayload`,
    `ProposedAction`, `ChatResolution`, `AiChatRequest`, `AiChatResponse` (per
    design.md).
  - **Covers:** R3.1, NFR3. _Verify:_ typecheck only.

- [x] **T5 — System prompt**
  - New `server/ai/budgetInstructions.ts`: `BUDGET_SYSTEM_PROMPT` (markdown string)
    — YNAB Rule 1, envelope conventions (strip prefixes, "Envelope" label),
    "propose, never execute; one action per turn", tone, and that it must call
    `get_budget` for live numbers rather than guessing.
  - **Tests** (`budgetInstructions.test.ts`): non-empty; asserts a couple of
    load-bearing phrases (propose-don't-execute; YNAB Rule 1) so the safety framing
    can't silently regress.
  - **Covers:** R2.1, NFR2. _Verify:_ `vitest run server/ai`, typecheck.

- [x] **T6 — Tool definitions + read handlers**
  - New `server/utils/aiTools.ts`: deterministically-ordered `TOOLS` with
    `cache_control` on the last definition; `input_schema`s mirroring the
    assign/transfer request bodies and the read queries; `READ_TOOL_HANDLERS`
    (`get_budget`→`getBudgetReport`, `get_transactions`→`getTransactionList`);
    `isProposedActionTool(name)` classifier; a `toProposedAction(toolUse)` mapper
    building `ProposedAction` + summary.
  - **Tests** (`aiTools.test.ts`): read handler delegates to the right util;
    classifier flags assign/transfer as proposed actions and reads as reads;
    `toProposedAction` builds correct payload + summary.
  - **Covers:** R1.2, R1.3, R2.1, NFR1, NFR2. _Verify:_ `vitest run server/utils/aiTools.test.ts`, typecheck.

- [x] **T7 — Chat route: the HITL tool loop (safety-critical)**
  - New `server/api/ai/chat.post.ts`: read `AiChatRequest`; cast `messages` to
    `MessageParam[]` at the boundary; on resume, append a `tool_result` user turn
    from `readToolResults` + `resolutions`. Run the manual loop: read tools execute
    & feed back; **proposed-action tools are surfaced, never executed**; bound by
    `MAX_TOOL_ITERATIONS`. Handle `refusal`, missing key (503), and API errors.
    Return `AiChatResponse`.
  - **Tests** (`server/api/ai/__tests__/chat.post.test.ts`), mock the SDK:
    - **R6.1 (load-bearing):** model emits `assign_to_envelope` → assert
      `appendTransaction`/assign endpoint called **0×**, `proposedActions`
      non-empty.
    - read-tool dispatch → feeds `tool_result`, loops to `end_turn`.
    - **R6.2:** resume with `approved` resolution → `tool_result` turn appended,
      loop resumes.
    - pending-proposal supersede (R3.4); refusal (R4.3); iteration cap (R4.4);
      missing key → 503 (R4.2).
  - **Covers:** R1.1, R1.4, R2.2–R2.6, R3.2–R3.4, R4.2–R4.5, R6. _Verify:_
    `vitest run server/api/ai`, typecheck.

- [x] **T8 — `useAiChat` composable**
  - New `composables/useAiChat.ts`: reactive `messages`/`reply`/`proposedActions`/
    `pending`/`error`; `send(text)`; `approve(action)` (calls the existing
    assign/transfer composable/endpoint, then resumes `/api/ai/chat` with an
    `approved` resolution + triggers budget refresh); `reject(action)`. Auto-reject
    un-acted proposals when `send` is called (R3.4). No business logic.
  - **Tests** (`useAiChat.test.ts`): send round-trip (mock `$fetch`); approve
    commits via the endpoint then resumes; reject resumes without committing;
    supersede behavior.
  - **Covers:** R2.3–R2.6, R3.1, R3.4, NFR1. _Verify:_ `vitest run composables/useAiChat.test.ts`, typecheck.

- [x] **T9 — Chat panel UI**
  - New `components/AiChatPanel.vue`: Nuxt UI chat suite (`UChatMessages`,
    `UChatMessage`, `UChatPrompt`, `UChatPromptSubmit`); a `UCard` proposed-action
    card with Approve/Reject + the action summary; persistent egress notice (R5.1);
    no-API-key empty state (R4.2); error display (R4.5). Renders only `reply` +
    `proposedActions` (never raw history).
  - Edit `pages/budget.vue` to mount the panel (slideover or side panel).
  - **Tests:** light component test if practical (render notice + card states);
    otherwise covered by manual run + the composable tests. State plainly which.
  - **Covers:** R2.1, R2.3, R2.4, R4.2, R4.5, R5.1. _Verify:_ typecheck; `npm run dev` smoke check.

- [x] **T10 — Egress/logging hygiene pass**
  - Confirm no `console.log` of message content or the key anywhere in the new
    code; the notice is present and persistent.
  - **Covers:** R5.1, R5.2. _Verify:_ grep the new files; typecheck.

- [x] **T11 — Full verification + map update**
  - `npx vitest run` (all green) and `npx nuxi typecheck` (0 errors).
  - Manual smoke: ask a question (reads), get a proposal, approve (commits + budget
    refreshes), reject (no write); unset key → empty state.
  - Main agent updates `AI-MAP.md`: `/api/ai/chat` route row; `anthropic.ts`,
    `aiTools.ts`, `budgetReport.ts`, `transactionList.ts` util rows;
    `useAiChat` composable; `AiChatPanel` component; budget-page panel; AI quirks
    (HITL invariant, `ANTHROPIC_API_KEY` env, data egress).
  - **Covers:** NFR5, NFR6. _Verify:_ both commands clean; map diff reviewed.

---

## Amendment — in-app API-key configuration (Issue #8, user-approved deviation)

- [x] **T12 — `aiConfig` util + key resolution**
  - New `server/utils/aiConfig.ts`: `readStoredApiKey` (sync, guarded, never throws),
    `writeStoredApiKey`/`clearStoredApiKey` (async), `maskApiKey` (last-4). Path
    `config/ai-config.json` (gitignored).
  - `server/utils/anthropic.ts`: `resolveApiKey` (env → stored), `getApiKeySource`,
    `getAnthropic` rebuilds the client when the resolved key changes (no restart).
  - **Tests:** `aiConfig.test.ts` (read/write/clear/mask, mocked fs); updated
    `anthropic.test.ts` (env-overrides-stored precedence, none → throws).
  - **Covers:** R4.1, R7.1–R7.4. _Verified:_ 15 tests green; typecheck.

- [x] **T13 — `GET/POST/DELETE /api/ai/config`**
  - `config.get.ts` (`{configured, source, maskedKey}` — never full key);
    `config.post.ts` (validate then `writeStoredApiKey`); `config.delete.ts`
    (`clearStoredApiKey`, env left intact).
  - **Tests** (`config.test.ts`): masked-only responses, validation 400s, env-override
    source, clear behavior.
  - **Covers:** R4.2, R7.4–R7.6. _Verified:_ 10 tests green; typecheck.

- [x] **T14 — Settings card + panel link**
  - `pages/settings.vue`: "AI Assistant" card (status, source badge, masked key,
    password input, Save, Clear-when-config-source). `AiChatPanel.vue` empty state
    links to Settings.
  - **Covers:** R4.2, R7.7. _Verified:_ typecheck; runtime curl flow (save → chat
    no longer 503 → clear).

- [x] **T15 — Verify + adversarial review + spec/map**
  - Full `vitest run` (384 green) + `nuxi typecheck` (0 errors); runtime probe of
    all `/api/ai/config` verbs + the no-restart effect. Adversarial multi-agent
    review of the secret handling. `design.md`/`requirements.md`/`AI-MAP.md` updated.

---

## Checkpoint

All tasks `- [x]`, `npx vitest run` and `npx nuxi typecheck` both clean, manual
HITL flow verified (propose → approve → commit; reject → no write; missing key →
empty state), `AI-MAP.md` updated. Then ready for commit/PR (PR body: `Fixes #8`).
