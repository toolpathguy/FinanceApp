# Tasks — AI-Assisted CSV Transaction Import (Human-in-the-Loop)

Implements [design.md](./design.md) and satisfies [requirements.md](./requirements.md)
(GitHub Issue #9). Ordered by dependency. Each task is small, independently verifiable,
names the files it touches and the tests to add, and cites the requirement(s) it covers.

Tests live beside source. Run a single file with
`npx vitest run <path>` while iterating; full suite + typecheck at the end.

---

- [x] **1. Shared types** — `types/import.ts`
  - Add `ImportDirection`, `ImportProposal`, `ImportParseResponse`, `CommitRow`,
    `ImportCommitRequest`, `ImportCommitResponse` (per design "Key interfaces").
  - Verify: `npx nuxi typecheck` clean (no runtime).
  - Covers: R1.2, R4.1, R5.1.

- [x] **2. Extract the shared write util** — `server/utils/transactionWriter.ts` + edit `server/api/transactions.post.ts`
  - Move `applyEnvelopePostings` + `toTransactionInput` + `appendTransaction`
    composition into `appendSimplifiedTransaction(input: SimplifiedTransactionInput)`.
  - Make `transactions.post.ts` a thin validate-and-call wrapper delegating to it.
  - Tests: new `server/utils/__tests__/transactionWriter.test.ts` (asset expense →
    2-posting; liability expense → 4-posting; income → asset+income). Re-run existing
    `transactions.post.ts` tests — must still pass (refactor parity).
  - Covers: R4.3, NF2; design "Refactor to enable clean reuse".

- [x] **3. Import context util** — `server/utils/importContext.ts`
  - `getImportContext()` → `{ accounts: string[]; envelopes: string[] }` via
    `hledgerExecText(['accounts'])` + existing `filterRealAccounts` /
    `filterCategoryAccounts`. CRLF-safe split.
  - Tests: `server/utils/__tests__/importContext.test.ts` — stub `hledgerExecText`,
    assert real accounts vs expense categories partitioned; CRLF trimmed.
  - Covers: R1.3, NF5.

- [x] **4. Dedup util** — `server/utils/importDedup.ts`
  - `computeDedupHash({date, amount, payee})` = `sha256(date|cents|payeeLowerTrimmed)`;
    `loadJournalHashes()` reads existing entries via `getTransactionList()` and returns
    a `Set<string>`.
  - Tests: `server/utils/__tests__/importDedup.test.ts` — hash stable across
    equivalent inputs (e.g. `$5.00` vs `5`); differs on date/payee/amount; whitespace/
    case-insensitive payee.
  - Covers: R5.1, R5.2, R5.3.

- [x] **5. Parse prompt, schema, normalization** — `server/utils/importParse.ts`
  - `IMPORT_SYSTEM_PROMPT` (map arbitrary CSV → normalized rows; positive magnitude +
    direction; ISO dates; suggest from provided accounts/envelopes; leave envelope blank
    if unsure; cache_control on the stable prefix), `IMPORT_SCHEMA` (json_schema,
    `additionalProperties:false`, model-returned fields only), `MAX_IMPORT_ROWS = 200`,
    and pure `normalizeProposals(parsed, context, sourceRows, journalHashes)` that
    validates dates/amounts, blanks bogus suggestions, computes `dedupHash` +
    `possibleDuplicate`, and collects `droppedRows`.
  - Tests: `server/utils/__tests__/importParse.test.ts` — signed single column →
    magnitude+direction; separate debit/credit → one direction; multi date-format →
    `YYYY-MM-DD`; bogus envelope blanked; unparseable row → `droppedRows`. fast-check
    property `importParse.property.test.ts`: normalized amount ≥ 0 and direction preserved.
  - Covers: R1.2, R1.4, R6.1, R6.2, R6.3.

- [x] **6. Parse route** — `server/api/import/parse.post.ts`
  - Resolve client (`getAnthropic()`, 503 on `MissingApiKeyError`); enforce
    `MAX_IMPORT_ROWS`; fetch context; call `client.messages.parse({...REQUEST_DEFAULTS,
    system, messages, output_config: { format: { type:'json_schema', schema: IMPORT_SCHEMA }}})`;
    handle `stop_reason: 'refusal'` and API errors (mirror #8's chat error mapping);
    run `normalizeProposals`; return `ImportParseResponse`. **No journal writes.**
  - Tests: `server/api/import/__tests__/parse.post.test.ts` — **(safety, R2.1)** mocked
    SDK returns rows → assert `appendTransaction` never called and proposals returned;
    missing key → 503; refusal → error + no proposals; over-cap → rejected.
  - Covers: R1.1, R1.2, R1.5, R2.1, R7.1, R7.2, R7.3.

- [x] **7. Commit route** — `server/api/import/commit.post.ts`
  - Re-validate each `CommitRow` (date/amount/account/envelope; outflow requires
    envelope); load journal hashes once; skip rows whose hash already exists; commit the
    rest via `appendSimplifiedTransaction`; return `{ committed, skippedDuplicates,
    failed }`. Partial success.
  - Tests: `server/api/import/__tests__/commit.post.test.ts` — approved rows committed;
    outflow w/ empty envelope rejected; inflow w/ empty envelope → income committed;
    existing-journal hash skipped (R5.3); two same-hash batch rows both attempted (R5.4);
    one invalid row doesn't block the valid ones (R4.2); writer failure → failed row, not a 500.
    (Commit needs no API key — local write; R7.2 correction.)
  - Covers: R2.2, R4.1, R4.2, R4.3, R4.4, R5.3, R5.4.

- [x] **8. Composable** — `composables/useImport.ts`
  - Reactive state + actions: `parse(csvText)`, editable proposal rows, approve/reject
    toggles, `commit()` (sends approved rows), result summary, loading/error, no-key
    flag. Thin `$fetch` client only — no business logic.
  - Tests: `composables/__tests__/useImport.test.ts` — parse populates rows; reject
    excludes a row from the commit payload; outflow-without-envelope not approvable;
    commit surfaces the summary.
  - Covers: R3.2, R3.3, R3.4, R4.1, NF1.

- [x] **9. Review table component** — `components/ImportReviewTable.vue`
  - UTable staging grid: date, payee (editable), amount, direction; account + envelope
    dropdowns from `context`; per-row approve toggle; `possibleDuplicate` badge;
    `sourceRow` shown (expandable/tooltip). Disable approve for outflow w/ empty envelope.
  - Verify: renders in the page (task 10); `npx nuxi typecheck` clean. (Light/no unit
    test — presentational; logic lives in the composable.)
  - Covers: R3.1, R3.2, R3.3, R3.5, R5.2.

- [x] **10. Import page + nav + egress notice** — `pages/import.vue`, edit `layouts/default.vue`
  - UFileUpload (read CSV text client-side) → `useImport.parse`; persistent egress
    notice before upload; no-key empty state linking to Settings; mount
    `ImportReviewTable`; commit button → `useImport.commit` + result summary
    (committed / skipped duplicates / failed). Add sidebar nav entry → Import.
  - Verify: `npm run dev`, upload a sample CSV, confirm proposals render, edit a row,
    approve, commit, and see the summary; confirm the egress notice is visible and the
    no-key state appears when the key is unset. State how it was checked.
  - Covers: R1.1, R3.1, R4.4, R7.2, R8.1.

- [x] **11. AI-MAP.md update** (main agent, after impl)
  - Add rows for the two `/api/import/*` routes, the new server utils
    (`importParse`, `importContext`, `importDedup`, `transactionWriter`), `useImport`,
    `ImportReviewTable`, `pages/import.vue`; note the CSV→Anthropic egress quirk.
  - Covers: project AI-map maintenance.

- [x] **12. Verification checkpoint**
  - `npx vitest run` — all tests pass (new + existing, incl. refactor-parity for
    `transactions.post.ts`).
  - `npx nuxi typecheck` — clean (exit 0).
  - `npm run build` — production build succeeds (page/component/routes compile).
  - Confirmed no `vitest.config` / `tsconfig` / `nuxt.config` / `package.json` changes.
  - NOTE: the live AI round-trip smoke test (upload → real Anthropic parse → commit)
    was NOT run — it needs a configured `ANTHROPIC_API_KEY` and a live API call. Static
    verification (build + typecheck + unit tests with a mocked SDK) is complete; the
    end-to-end UI run is left for the user to confirm with a key configured.
  - Covers: NF3, NF4, NF6.

---

### Suggested commit points (batch over noise)

- After **task 2** (refactor lands, parity green) — safe standalone commit.
- After **task 7** (server side complete: types, utils, both routes, all server tests).
- After **task 10** (UI works end-to-end).
- After **task 12** (map updated, full verification) — final.

PR (when requested): body starts with `Fixes #9`, conventional-commit title
(`feat: AI-assisted CSV transaction import (human-in-the-loop)`).
