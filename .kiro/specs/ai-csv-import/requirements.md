# Requirements — AI-Assisted CSV Transaction Import (Human-in-the-Loop)

Traceable to **GitHub Issue #9**. Builds on the merged #8 AI budgeting chat (PR #16).
Acceptance criteria use EARS form ("WHEN … THE SYSTEM SHALL …"). Each requirement
notes the design section it derives from.

---

## R1 — Upload a CSV and get AI-extracted proposals

**User story:** As a budgeter, I want to upload a bank CSV and have the app turn its
arbitrary layout into a list of proposed transactions, so I don't hand-enter them.

- R1.1 — WHEN the user selects a `.csv` file on the import page, THE SYSTEM SHALL read
  its text client-side and POST it to `POST /api/import/parse`.
- R1.2 — WHEN `parse` receives CSV text, THE SYSTEM SHALL call the Anthropic API with a
  JSON-schema structured-output request and return normalized proposals
  (`{ date, payee, amount, direction, suggestedAccount, suggestedEnvelope }` per row,
  enriched server-side with `id`, `dedupHash`, `possibleDuplicate`, `sourceRow`).
- R1.3 — THE SYSTEM SHALL ground the model's `suggestedAccount` / `suggestedEnvelope`
  in the real account/envelope list fetched from hledger (`getImportContext()`), and
  SHALL blank any suggestion that does not match a real target.
- R1.4 — WHEN the model returns rows it could not parse, THE SYSTEM SHALL surface them
  in `droppedRows` with a reason; THE SYSTEM SHALL NOT silently discard any input row.
- R1.5 — WHEN the CSV exceeds `MAX_IMPORT_ROWS` (200), THE SYSTEM SHALL reject the
  request with a clear message asking the user to split the file, and SHALL NOT
  truncate the input.

*(Design: parse path, "Bounding output size".)*

---

## R2 — Safety: parse never writes

**User story:** As a user, I want certainty that uploading/previewing never changes my
ledger, so I can review safely.

- R2.1 — WHEN `POST /api/import/parse` runs for any input, THE SYSTEM SHALL NOT call
  `appendTransaction` or otherwise modify the journal file.
- R2.2 — THE SYSTEM SHALL perform all journal writes exclusively in
  `POST /api/import/commit`, and only for rows the user approved.

*(Design: Non-negotiable safety invariant. Load-bearing test in tasks.md.)*

---

## R3 — Review and edit before approving

**User story:** As a budgeter, I want to review and correct each proposed row before
anything is saved.

- R3.1 — WHEN proposals are returned, THE SYSTEM SHALL display them in a staging table
  with the date, payee, amount, direction, and editable account + envelope dropdowns
  populated from the parse `context`.
- R3.2 — THE SYSTEM SHALL let the user edit a row's account, envelope, and payee, and
  approve or reject each row individually.
- R3.3 — WHEN a row's direction is `outflow` AND its envelope is empty, THE SYSTEM
  SHALL prevent that row from being approved (an outflow must hit a category).
- R3.4 — WHEN a row's direction is `inflow` AND its envelope is empty, THE SYSTEM SHALL
  allow approval (it commits as income → Ready to Assign).
- R3.5 — THE SYSTEM SHALL display the original CSV line (`sourceRow`) for each proposal
  so the user can verify the mapping.

*(Design: review/commit paths, Uncategorized handling.)*

---

## R4 — Commit only approved rows

**User story:** As a user, I want only the rows I approved to be written, as balanced
journal entries.

- R4.1 — WHEN the user commits, THE SYSTEM SHALL send only approved (possibly-edited)
  rows to `POST /api/import/commit`.
- R4.2 — WHEN `commit` receives a row, THE SYSTEM SHALL re-validate it server-side
  (valid `YYYY-MM-DD` date; amount > 0; account is a real account; envelope, if
  present, is a real expense category) and SHALL reject invalid rows with a per-row
  error while still committing the valid ones (partial success).
- R4.3 — WHEN a valid row is committed, THE SYSTEM SHALL write it via the shared
  `appendSimplifiedTransaction()` util (`outflow` → `expense`, `inflow` → `income`),
  producing a balanced, integer-cents journal entry.
- R4.4 — THE SYSTEM SHALL return a summary `{ committed, skippedDuplicates, failed }`
  and the UI SHALL display it.

*(Design: commit path, Direction → type mapping, refactor.)*

---

## R5 — Duplicate detection (flag, don't silently drop)

**User story:** As a user re-importing a statement, I don't want duplicate transactions
written — but I also don't want legitimate identical transactions silently lost.

- R5.1 — THE SYSTEM SHALL compute `dedupHash = sha256(date|cents|payeeLowercased)` for
  every proposal and commit row.
- R5.2 — WHEN a proposal's hash matches an existing journal entry at parse time, THE
  SYSTEM SHALL mark it `possibleDuplicate: true` and the table SHALL badge it.
- R5.3 — WHEN an approved row's hash matches an existing journal entry at commit time,
  THE SYSTEM SHALL skip writing it and report it in `skippedDuplicates`.
- R5.4 — WHEN two approved rows in the same batch share a hash, THE SYSTEM SHALL treat
  them as distinct (surface both; do not auto-merge) — only journal-existing matches are
  skipped.

*(Design: Dedup hash, commit dedup.)*

---

## R6 — Messy real-world CSV handling

**User story:** As a user, my bank's CSV has odd formats; the import should cope.

- R6.1 — THE SYSTEM SHALL normalize varied date formats (ISO, `MM/DD/YYYY`,
  `DD/MM/YYYY`, `D Mon YYYY`) to `YYYY-MM-DD`.
- R6.2 — THE SYSTEM SHALL produce a positive `amount` magnitude plus a separate
  `direction`, correctly mapping both a single signed-amount column and separate
  debit/credit columns.
- R6.3 — THE SYSTEM SHALL leave `suggestedEnvelope` blank when no confident category
  match exists, rather than inventing a category.

*(Design: parse normalization, Uncategorized.)*

---

## R7 — Reuse the #8 AI plumbing and key config

**User story:** As a user who already configured my API key for the chat, I want import
to use the same key with no extra setup.

- R7.1 — THE SYSTEM SHALL resolve the Anthropic key via the existing
  `server/utils/anthropic.ts` (`env → config/ai-config.json → none`), with no new key UI.
- R7.2 — WHEN no API key is configured, THE SYSTEM SHALL return 503 from **parse**
  and the import page SHALL show a "configure your API key" empty state linking to
  Settings. (Commit performs a purely local journal write and needs no key, so it does
  not gate on one — implementation correction to the original "parse/commit".)
- R7.3 — WHEN the Anthropic call fails (network/billing/rate-limit/refusal), THE SYSTEM
  SHALL surface an actionable message and SHALL NOT write a partial/garbage entry.

*(Design: reuse, Refusal caveat. Mirrors #8 error handling.)*

---

## R8 — Data-egress transparency

**User story:** As a privacy-conscious user, I want to know my transaction text leaves
my machine.

- R8.1 — THE import page SHALL display a persistent, visible notice that the CSV
  contents are sent to the Anthropic API, shown before/at upload.
- R8.2 — THE SYSTEM SHALL NOT log CSV contents or the API key.

*(Design: Data egress section — Issue #9 risk note.)*

---

## Non-functional requirements

- **NF1 — Separation of concerns.** Pages fetch via the `useImport` composable; the
  composable calls `/api/import/*`; routes delegate to `server/utils`; only
  `server/utils` (journalWriter / transactionWriter / hledger) touch the journal or
  spawn hledger. Account-name shaping / amount formatting use existing `utils/` helpers.
- **NF2 — No new accounting logic.** Commits reuse the existing simplified-transaction →
  `journalWriter` path via the extracted `appendSimplifiedTransaction`; no balance math
  is reimplemented.
- **NF3 — Types & casts.** No `any` / unnecessary `as` outside validated trust
  boundaries (parsing the Anthropic response, reading request bodies). `any` allowed in
  tests for SDK mocks.
- **NF4 — Tooling untouched.** No changes to `vitest.config`, `tsconfig`, `nuxt.config`,
  or `package.json` scripts/deps (`@anthropic-ai/sdk` already present).
- **NF5 — Windows/CRLF.** hledger output parsed with `split(/\r?\n/)` + trim; account
  args passed after `--` (existing utils already do this).
- **NF6 — Verification.** `npx vitest run` and `npx nuxi typecheck` both clean before
  the feature is considered done.

---

## Out of scope (restated)

Streaming/chunked parsing of large statements; direct bank/aggregator connections;
auto-creating envelopes during import; multi-currency CSVs; persisted import history /
undo; multi-user auth.
