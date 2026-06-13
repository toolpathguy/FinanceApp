# Requirements — Server Security Hardening

> Traces to **GitHub Issue #2**. Acceptance criteria in EARS form
> ("WHEN … THE SYSTEM SHALL …"). Derived from the approved [design.md](./design.md).

## R1 — Journal injection prevention (Finding 1, High)

**User story:** As the journal owner, I want free-text fields rejected when they
contain newline/tab characters, so a malicious payee or category name cannot
forge additional postings or transactions in my ledger.

- 1.1 — WHEN `validateTransaction` receives a `description` containing `\r`, `\n`, or `\t`, THE SYSTEM SHALL return a non-empty error array (the transaction is not written).
- 1.2 — WHEN any posting `account` contains `\r`, `\n`, or `\t`, THE SYSTEM SHALL return a validation error.
- 1.3 — WHEN any posting `commodity` is present and contains `\r`, `\n`, or `\t`, THE SYSTEM SHALL return a validation error.
- 1.4 — WHEN `POST /api/categories` receives a `name` containing `\r`, `\n`, or `\t`, THE SYSTEM SHALL respond `400` and SHALL NOT write to the journal.
- 1.5 — WHEN a field contains a `;` (or other non-control printable characters such as unicode), THE SYSTEM SHALL accept it (only `\r\n\t` are illegal).
- 1.6 — WHEN validation fails on any write path (`transactions.post`, `budget/assign.post`, `budget/transfer.post`, `categories.post`), THE SYSTEM SHALL leave the journal file byte-for-byte unchanged.

## R2 — Path-traversal prevention (Finding 2, High)

**User story:** As the journal owner, I want journal file creation/upload confined
to the managed `journals/` directory, so no request can read or overwrite files
elsewhere on disk.

- 2.1 — WHEN `journal/create.post` or `journal/upload.post` receives a `filename` containing a path separator (`/` or `\`) or a `..` segment, THE SYSTEM SHALL respond `400` and SHALL NOT create or write any file.
- 2.2 — WHEN the `filename` does not end in `.journal`, `.hledger`, or `.j`, THE SYSTEM SHALL respond `400` (enforced on **both** create and upload).
- 2.3 — WHEN the `filename` is valid, THE SYSTEM SHALL resolve it to a path inside `JOURNALS_DIR` and write there.
- 2.4 — WHEN `journal/upload.post` is called with no `filename`, THE SYSTEM SHALL write to the currently active journal (unchanged behavior).
- 2.5 — THE resolved write path SHALL always satisfy `resolvedPath.startsWith(JOURNALS_DIR + sep)`.

## R3 — Restricted, persisted journal activation (Finding 3, High)

**User story:** As the journal owner, I want only managed journals to be
activatable and the active choice to survive restarts, so arbitrary files can't
be surfaced through the read APIs and concurrent requests can't race on it.

- 3.1 — WHEN `journal/activate.post` receives a `filename` that is neither a file inside `JOURNALS_DIR` nor the bundled `test-data/sample.journal`, THE SYSTEM SHALL respond `400` or `404` and SHALL NOT change the active journal.
- 3.2 — WHEN an allowed `filename` does not exist on disk, THE SYSTEM SHALL respond `404`.
- 3.3 — WHEN activation succeeds, THE SYSTEM SHALL persist the choice to `config/active-journal.json`.
- 3.4 — WHEN `resolveJournalPath()` is called, THE SYSTEM SHALL return, in precedence order: the value in `config/active-journal.json` (if present and readable), else `process.env.LEDGER_FILE`, else `test-data/sample.journal`.
- 3.5 — WHEN `config/active-journal.json` is absent or unreadable, THE SYSTEM SHALL fall back without throwing (identical to current behavior).
- 3.6 — A successful activation SHALL be reflected by subsequent reads (`/api/transactions`, `/api/accounts`, `/api/budget`) within the same and future processes.

## R4 — hledger argument-injection prevention (Finding 4, Medium)

**User story:** As the journal owner, I want read-query parameters validated
before reaching hledger, so a crafted value can't be interpreted as an hledger
flag and change or leak output.

- 4.1 — WHEN `transactions.get` receives a `startDate` or `endDate` that is not `YYYY-MM-DD`, THE SYSTEM SHALL respond `400` and SHALL NOT spawn hledger.
- 4.2 — WHEN `transactions.get` receives an `account` outside the allowed charset (`[A-Za-z0-9:_ -]`, ≤100 chars) or beginning with `-`, THE SYSTEM SHALL respond `400`.
- 4.3 — WHEN a valid `account` query is forwarded, THE SYSTEM SHALL place it after a `--` separator in the hledger argv.
- 4.4 — WHEN `budget.get` receives a `period` outside the allowed charset (`[A-Za-z0-9 \/-]`, ≤40 chars) or beginning with `-`, THE SYSTEM SHALL respond `400` and SHALL NOT spawn hledger.
- 4.5 — WHEN a query parameter is empty/whitespace or absent, THE SYSTEM SHALL treat it as absent (no error), preserving current behavior.

## Non-functional requirements

- **NFR1 — Layering:** validators are pure where possible and live in
  `server/utils/`; API routes call them at the boundary and do not inline
  `child_process`/`fs`/path logic (per `separation-of-concerns.md`).
- **NFR2 — Fail closed, clear messages:** every rejection returns a `4xx` with a
  human-readable `statusMessage`/`message`; no silent sanitization.
- **NFR3 — No regressions:** all existing tests, typecheck (`npx nuxi typecheck`),
  and the full Vitest suite pass. Legitimate transactions, uploads, and queries
  that work today continue to work.
- **NFR4 — Test coverage:** each finding gets unit tests for the validator plus a
  route-level test asserting the `4xx`/no-write behavior. Property tests
  (fast-check) cover the injection and traversal validators where natural.
- **NFR5 — Windows/CRLF:** validators behave correctly on CRLF input and Windows
  path forms (`\` separators, drive letters).

## Out of scope

- **Authentication / network binding.** The API stays unauthenticated and
  file-mutating under the documented local single-user model. A separate issue
  should decide localhost binding or auth before any hosted/multi-user deploy.
- **The accounting-correctness (#3) and robustness (#4) findings** — separate
  issues/specs.
- Rate limiting, audit logging, and CSRF — not applicable to the local model.
