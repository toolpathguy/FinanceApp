# Design — AI-Assisted CSV Transaction Import (Human-in-the-Loop)

## Introduction

Implements **GitHub Issue #9** (`toolpathguy/FinanceApp`): let the user upload a bank
CSV they exported themselves and have the AI map an **arbitrary CSV layout** to
normalized transactions. The AI **proposes** rows; the user reviews/edits them in
a staging table (account, envelope, payee) and **approves**; only then are they
committed via the existing direct journal writer. Nothing is written without
explicit per-row approval.

This builds directly on the merged **#8 AI budgeting chat** (PR #16): it reuses
`server/utils/anthropic.ts` (shared client + key resolution), `server/utils/aiConfig.ts`
(Settings-page key), `types/ai.ts` patterns, and the **propose → approve → commit**
HITL spine. It introduces no new accounting logic — commits flow through the same
simplified-transaction → `journalWriter` path that `POST /api/transactions` already
uses (extracted to a shared util so neither route duplicates the envelope math).

### Non-negotiable safety invariant

> **The parse route never writes to the journal.** `POST /api/import/parse` only
> reads (account list) and calls Anthropic; it returns *proposals*. A write happens
> only in `POST /api/import/commit`, and only for rows the user explicitly approved.
> Covered by a dedicated test (R from requirements.md): a parse call records zero
> `appendTransaction` calls.

---

## Why structured outputs, not a tool loop

#8's chat is an **agentic tool loop** (read tools + proposed-action tools, paused for
approval). CSV parse is the opposite shape: a **single, one-shot extraction** with no
agency. The right primitive is **structured outputs**, not tools.

- **`claude-opus-4-8` supports structured outputs** via
  `output_config: { format: { type: 'json_schema', schema } }`. The SDK's
  `client.messages.parse()` validates the response against the schema and returns a
  typed `parsed_output` (null on parse failure) — no manual JSON parsing, no
  brittle string handling.
- **Compatible with adaptive thinking** — structured outputs works alongside
  `thinking: { type: 'adaptive' }`, so we keep the shared `REQUEST_DEFAULTS` from #8
  unchanged. No forced `tool_choice` is needed (forcing a tool would be the wrong
  tool for the job and interacts awkwardly with thinking).
- **Caveats the design accounts for:**
  - JSON Schema is constrained: every object needs `additionalProperties: false`,
    and `minLength`/`maxLength`/numeric bounds/recursion are unsupported (the SDK
    strips unsupported keywords and validates client-side). Our schema stays within
    the supported subset; per-field bounds are enforced in our own validation pass.
  - **Refusal:** on `stop_reason: 'refusal'` the output may not match the schema —
    the route returns a clear error and writes nothing.
  - **Incompatible with prefill / citations** (neither is used here).

---

## Architecture & data flow

```
pages/import.vue ─────────────────────────┐
  (UFileUpload + egress notice +          │  approve →  composables/useImport.commit()
   ImportReviewTable: edit/approve rows)   │            POST /api/import/commit
            │                              │                     │
            ▼                              │                     ▼
composables/useImport.ts ──────────────────┘        server/api/import/commit.post.ts
  parse(): POST /api/import/parse                       ├─ dedup vs journal (importDedup.ts)
            │                                           └─ appendSimplifiedTransaction()  ← shared write util
            ▼                                                      │ (NEW, extracted from transactions.post.ts)
server/api/import/parse.post.ts            ← reads only; NEVER writes
   ├─ server/utils/anthropic.ts            ← shared SDK client + key (reused from #8)
   ├─ server/utils/importParse.ts          ← system prompt + JSON schema + normalization + validation
   └─ server/utils/importContext.ts        ← valid real accounts + envelope keys (delegates to filterAccounts)
```

The **system prompt + JSON schema** are the stable, cacheable prefix
(`cache_control: { type: 'ephemeral' }`). The **CSV text and the account/envelope
context are volatile** and go in the user message *after* the cached prefix, so the
cache stays warm across imports.

---

## The parse path (`POST /api/import/parse`)

1. Client uploads CSV text (read client-side from the chosen file).
2. Route resolves the Anthropic client (`getAnthropic()`); 503 + empty state if no key
   (same handling as #8's chat route).
3. Route fetches **import context** — the list of valid real accounts
   (`assets:` / `liabilities:`) and valid envelope keys (expense categories), via
   `getImportContext()` (delegates to `hledgerExecText(['accounts'])` + the existing
   `filterRealAccounts` / `filterCategoryAccounts` pure utils). This grounds the
   model's `suggestedAccount` / `suggestedEnvelope` in **real** targets.
4. Route calls `client.messages.parse({ ...REQUEST_DEFAULTS, system, messages, output_config })`
   with the `IMPORT_SCHEMA` (one-shot, non-streaming).
5. `parsed_output` is normalized + validated by `normalizeProposals()` (pure):
   - date → `YYYY-MM-DD` (handle `MM/DD/YYYY`, `DD/MM/YYYY` ambiguity via a hint the
     model emits, `D Mon YYYY`, ISO, etc. — the model returns ISO; we re-validate);
   - amount → positive magnitude in dollars, sign dropped, direction carried
     separately (`inflow` | `outflow`) — covers single signed-amount columns **and**
     separate debit/credit columns (the model maps either to one direction + magnitude);
   - `suggestedAccount` / `suggestedEnvelope` kept only if they match a real target,
     else blank (blank envelope is legal — see Uncategorized below);
   - a stable `dedupHash` (see Dedup) is computed per row.
6. Returns `{ proposals: ImportProposal[], context: { accounts, envelopes }, droppedRows }`.
   `context` feeds the review table's account/envelope dropdowns; `droppedRows`
   reports any rows the model couldn't parse (never silently dropped — R requirement).

**No iteration loop, no pending-tool protocol.** One request, one structured response.

### Bounding output size

Output scales with row count. v1 caps the CSV at **`MAX_IMPORT_ROWS = 200`** rows per
parse and sets `max_tokens` accordingly (non-streaming, well under the SDK HTTP-timeout
threshold). Larger files return a 413-style message asking the user to split the file.
Chunked/streamed parsing of very large statements is a deferred enhancement (see
Alternatives); the wire contract doesn't change when it's added.

---

## The commit path (`POST /api/import/commit`)

1. Client sends only the **approved, possibly-edited** rows (`CommitRow[]`): final
   `date, payee, amount, direction, account, envelope`.
2. Route re-validates each row server-side (date format, amount > 0, account is a real
   account, envelope — if present — is a real expense category). Invalid rows are
   rejected with per-row errors; the rest still commit (partial success is reported).
3. **Dedup** (`importDedup.ts`): build the set of existing-journal dedup hashes once
   (from `getTransactionList()` / `hledger print`), and skip any approved row whose
   hash already exists — **reported as skipped, not silently dropped**. Because every
   committed row becomes a real journal entry, re-importing the same statement later is
   caught by this same journal check — **no separate "imported ledger" file is needed**
   (keeps the server stateless, consistent with the rest of the app).
   - Dedup is a **safety net, not a hard gate at parse time**: legitimately-identical
     rows (two $5 coffees, same day/payee) are surfaced in the review table as
     "possible duplicate" so the user decides; the commit-time journal check prevents
     accidental *re-import* of an already-committed batch.
4. Each surviving row → `SimplifiedTransactionInput` → **`appendSimplifiedTransaction()`**
   (the shared write util), which runs `toTransactionInput` + envelope postings +
   `appendTransaction` (validate → format → `fs.appendFile`, integer-cents balancing).
5. Returns `{ committed: number, skippedDuplicates: CommitRow[], failed: {row, error}[] }`.

### Direction → transaction type mapping

| CSV direction | Maps to | Postings |
|---|---|---|
| `outflow` (money leaves the account) | `expense` | debit chosen envelope's `expenses:` category, credit the budget sub-account (existing envelope-aware logic) |
| `inflow` (money enters the account) | `income` | debit the real account, credit `income:` — lands in Ready-to-Assign per YNAB Rule 1 |

### Uncategorized handling (Issue #9 requirement)

- **Inflow with no envelope** → income → naturally lands in **Ready to Assign** (RTA =
  net worth − envelope balances; an income inflow with no assignment raises RTA). This
  is the intended resting place; no special-casing needed.
- **Outflow with no envelope** → the review table **requires** an envelope before the
  row can be approved (an outflow must hit a category to keep the budget balanced).
  The model suggests one; the user can change it. Rows left uncategorized are simply
  not approvable — they never reach commit.

---

## Refactor to enable clean reuse (no behavior change)

`POST /api/transactions` currently inlines `applyEnvelopePostings` + `toTransactionInput`
+ `appendTransaction`. Extract that composition into:

- **`server/utils/transactionWriter.ts`** — `appendSimplifiedTransaction(input: SimplifiedTransactionInput): Promise<void>`,
  moving `applyEnvelopePostings` (which already delegates to `resolveBudgetBase`) out of
  the route. `transactions.post.ts` becomes a thin validate-and-call wrapper; the import
  commit route calls the same function. This mirrors how #8 extracted `getBudgetReport`
  from `budget.get.ts`, and keeps the **accounting logic in one place** (separation-of-concerns:
  no envelope math duplicated across two routes). Existing `transactions.post.ts` tests
  still pass against the delegate (refactor parity).

---

## Key interfaces / types (`types/import.ts`)

```ts
export type ImportDirection = 'inflow' | 'outflow'

/** A normalized transaction the AI proposed from one CSV row. */
export interface ImportProposal {
  id: string                 // stable per-row id (index-based) for the review table
  date: string               // YYYY-MM-DD (validated)
  payee: string
  amount: number             // positive magnitude
  direction: ImportDirection
  suggestedAccount: string   // real account path, or '' if unknown
  suggestedEnvelope: string  // expense category key, or '' (uncategorized)
  dedupHash: string          // sha256(date|cents|payee) — see Dedup
  possibleDuplicate: boolean // hash already present in the journal at parse time
  sourceRow: string          // raw CSV line, for display + user trust
}

export interface ImportParseResponse {
  proposals: ImportProposal[]
  context: { accounts: string[]; envelopes: string[] }  // dropdown options
  droppedRows: { sourceRow: string; reason: string }[]  // never silently dropped
}

/** A row the user approved (and possibly edited) in the review table. */
export interface CommitRow {
  date: string
  payee: string
  amount: number
  direction: ImportDirection
  account: string            // chosen real account
  envelope: string           // chosen expense category ('' only allowed for inflow)
  dedupHash: string
}

export interface ImportCommitRequest { rows: CommitRow[] }
export interface ImportCommitResponse {
  committed: number
  skippedDuplicates: CommitRow[]
  failed: { row: CommitRow; error: string }[]
}
```

The JSON schema passed to Anthropic (`IMPORT_SCHEMA` in `importParse.ts`) is the
proposal shape **minus** the purely-server-computed fields (`id`, `dedupHash`,
`possibleDuplicate`) — the model returns `{ date, payee, amount, direction,
suggestedAccount, suggestedEnvelope, sourceRow }[]`, and the server adds the rest.
**Refinement during implementation:** the model echoes the verbatim original CSV line
as `sourceRow` (rather than the server reconstructing it), which gives reliable per-row
provenance for display and lets the normalizer attribute every dropped row to its source.
Every object carries `additionalProperties: false` (structured-outputs requirement).

---

## Dedup hash

`dedupHash = sha256(`${date}|${Math.round(amount*100)}|${payee.trim().toLowerCase()}`)`.
Date + integer cents + normalized payee. Computed identically at parse time (to flag
`possibleDuplicate` against the existing journal) and at commit time (to skip rows
already in the journal). Collisions between genuinely-distinct same-day/same-amount/same-payee
transactions are treated as *possible duplicates to confirm*, never as silent drops.

---

## Files added / changed

| File | Change |
|---|---|
| `server/api/import/parse.post.ts` (new) | reads context, calls Anthropic structured output, returns proposals; 503 when key missing; never writes |
| `server/api/import/commit.post.ts` (new) | re-validates, dedups, commits approved rows via the shared write util |
| `server/utils/importParse.ts` (new) | `IMPORT_SYSTEM_PROMPT`, `IMPORT_SCHEMA`, `normalizeProposals()`, per-field validation, `MAX_IMPORT_ROWS` |
| `server/utils/importContext.ts` (new) | `getImportContext()` → `{ accounts, envelopes }` (delegates to `filterAccounts` utils) |
| `server/utils/importDedup.ts` (new) | `computeDedupHash()`, `loadJournalHashes()` (reads existing journal via `getTransactionList`) |
| `server/utils/transactionWriter.ts` (new) | `appendSimplifiedTransaction()` extracted from `transactions.post.ts` |
| `server/api/transactions.post.ts` (edit) | delegate to `appendSimplifiedTransaction` (thin wrapper) |
| `composables/useImport.ts` (new) | reactive state: upload, parse, edit, approve/reject, commit, result summary |
| `components/ImportReviewTable.vue` (new) | UTable staging grid: per-row account/envelope/payee edit, approve toggles, duplicate badge |
| `pages/import.vue` (new) | UFileUpload + persistent egress notice + no-key empty state + review table + commit |
| `layouts/default.vue` (edit) | sidebar nav entry → Import |
| `types/import.ts` (new) | wire + proposal types above |
| `AI-MAP.md` | new route/util/composable/page rows + CSV-egress quirk (main agent, after impl) |

No new dependency (`@anthropic-ai/sdk` already present from #8). No config changes.

---

## Data egress (must document prominently — Issue #9 risk note)

CSV rows — transaction descriptions and amounts — are sent to the Anthropic API to
perform the mapping. This is the **one external data flow** in the app (same as #8's
chat). No bank credentials, no aggregator, no stored secrets beyond `ANTHROPIC_API_KEY`.
`pages/import.vue` shows a **persistent, visible notice** before upload ("The contents
of this CSV are sent to Anthropic to extract transactions"), captured as a requirement,
not just a code comment.

---

## Alternatives considered

- **Forced `tool_choice` to emit transactions** — rejected. Structured outputs
  (`output_config.format`) is the purpose-built primitive for one-shot JSON extraction,
  returns a validated `parsed_output`, and stays cleanly compatible with adaptive
  thinking. A forced single-tool call is the wrong shape and adds tool-protocol
  overhead for no benefit.
- **Reuse #8's agentic tool loop** — rejected. Parse has no agency: no reads to chain,
  no actions to pause on. A loop would add latency and complexity for a single
  extraction.
- **A fixed per-bank CSV parser** — rejected (this is the whole point of #9): bank
  layouts vary wildly (column names, date formats, single signed column vs separate
  debit/credit, sign conventions). The AI mapping is the feature's value-add.
- **A separate "imported transactions" ledger for dedup** — rejected. Committed rows
  are real journal entries, so the journal *is* the dedup source; checking against it
  catches re-imports without adding persistent state.
- **Hard-block duplicates at parse time** — rejected. Identical same-day transactions
  are legitimate; silently dropping them loses real data. Dedup flags possibles for the
  user (HITL) and only the commit-time journal check prevents accidental batch
  re-import.
- **Streaming the parse response** — deferred. v1 caps rows and is non-streaming
  (replies stay under the timeout threshold). Streaming + chunked parsing of large
  statements is a later enhancement; `ImportParseResponse` is unchanged by it.
- **New API-key UI** — avoided. Reuse #8's `aiConfig` + Settings card; the no-key
  empty state links there.

---

## Testing strategy (detail in tasks.md)

- **Load-bearing safety test:** a parse call with a mocked Anthropic client records
  **zero** `appendTransaction` / journal-writer calls; the response carries proposals.
- **Parse normalization (pure, `normalizeProposals`):** signed single-column → magnitude
  + direction; separate debit/credit columns → one direction; multiple date formats →
  `YYYY-MM-DD`; bogus `suggestedEnvelope` not in context → blanked; unparseable row →
  surfaced in `droppedRows`, never dropped silently. fast-check property: output amounts
  are always ≥ 0 and direction is preserved.
- **Dedup (`importDedup`):** a row whose hash matches an existing journal entry is
  flagged `possibleDuplicate` at parse and **skipped** at commit; two identical rows in
  one batch are both surfaced (not auto-merged).
- **Commit:** approved rows commit via `appendSimplifiedTransaction`; outflow with empty
  envelope is rejected; inflow with empty envelope commits (→ RTA); partial success
  reports `committed` / `skippedDuplicates` / `failed`.
- **Refactor parity:** existing `transactions.post.ts` tests pass against the
  `appendSimplifiedTransaction` delegate (no behavior change).
- **Missing key:** parse/commit with no `ANTHROPIC_API_KEY` → 503, clear message.
- **Refusal:** mocked `stop_reason: 'refusal'` → parse returns an error, no proposals,
  no writes.
- Mock Nitro globals with `vi.stubGlobal()` per project convention; mock the Anthropic
  SDK (`any` allowed in tests). Full `npx vitest run` + `npx nuxi typecheck` clean at the
  end.

---

## Out of scope

- Streaming / chunked parsing of very large statements (deferred; v1 caps at
  `MAX_IMPORT_ROWS`).
- Direct bank/aggregator connections (the #9 pivot away from Stripe/Plaid — CSV only).
- Auto-creating new envelopes/categories during import (user picks from existing).
- Multi-currency CSVs (single `$` commodity, consistent with the rest of the app).
- Persisting import history / undo (deletes use the existing register delete-by-index).
- Multi-user auth / per-user keys (single-user local app).
