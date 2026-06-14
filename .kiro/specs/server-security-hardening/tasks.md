# Tasks — Server Security Hardening

> Implements [design.md](./design.md), satisfies [requirements.md](./requirements.md).
> Traces to **GitHub Issue #2**. Work on branch `fix/server-security-hardening`.
> Implement top-to-bottom; each task is independently verifiable. Run the
> relevant test file after each task, not the whole suite.

- [x] **T1 — Journal injection guard** _(R1.1–1.3, 1.5, 1.6)_
  - In `server/utils/journalWriter.ts`: add `fieldHasIllegalChars(value)` (`/[\r\n\t]/`) and export it.
  - Add rules 7–9 to `validateTransaction`: reject illegal chars in `description`, each posting `account`, and each present `commodity`.
  - Tests in `server/utils/__tests__/journalWriter.test.ts`: newline/tab in description, account, commodity → error; `;`/unicode payee → no error.
  - Add a property test in `journalWriter.property.test.ts`: any input with `\r\n\t` in a guarded field is rejected; clean inputs unaffected.

- [x] **T2 — Category name guard** _(R1.4, 1.6)_
  - In `server/api/categories.post.ts`: reject `name` via `fieldHasIllegalChars` with `400` before building the account.
  - Add a route test (mock `addTransaction`) asserting `400` + `addTransaction` not called for a `\n` name.

- [x] **T3 — `safeJournalPath` helper** _(R2.1–2.3, 2.5)_
  - New `server/utils/journalFiles.ts`: export `JOURNALS_DIR` and `safeJournalPath(filename)` (trim → `basename === name` → extension → `resolve`/`startsWith` backstop), throwing `createError(400)`.
  - New `server/utils/__tests__/journalFiles.test.ts`: rejects `../x`, `a/b`, `a\\b`, absolute/drive paths, bad extension; accepts `budget.journal`. Property test: any name with a separator or `..` is rejected (NFR5).

- [x] **T4 — Apply `safeJournalPath` to create/upload** _(R2.1–2.4)_
  - `journal/create.post.ts`: replace inline `join(...)` with `safeJournalPath`.
  - `journal/upload.post.ts`: use `safeJournalPath` when `filename` present (now also enforcing extension); keep the no-filename → active-journal branch.
  - Route tests: traversal/bad-extension filename → `400` no write; valid filename writes inside `JOURNALS_DIR`; upload with no filename still targets active journal.

- [x] **T5 — `resolveJournalPath` precedence + persistence** _(R3.3–3.5)_
  - In `server/utils/hledger.ts`: `resolveJournalPath()` reads `config/active-journal.json` (sync, try/catch) → `process.env.LEDGER_FILE` → `'test-data/sample.journal'`.
  - Unit tests in `hledger.test.ts`: config present wins; absent/corrupt → env; neither → sample. (Mock `fs` reads.)

- [x] **T6 — Restrict + persist activation** _(R3.1, 3.2, 3.3, 3.6)_
  - `journal/activate.post.ts`: accept only the bundled `test-data/sample.journal` or a `safeJournalPath(basename(filename))`; `existsSync` → `404` if missing; on success write `config/active-journal.json` (and set `process.env.LEDGER_FILE` for current-process immediacy).
  - Route tests: arbitrary path (e.g. `/etc/passwd`, `C:\\Windows\\...`) → `400`/`404` and no state change; valid journals-dir file → writes config; sample journal allowed.
  - Confirm `config/` is gitignored (add `config/active-journal.json` to `.gitignore` if needed).

- [x] **T7 — hledger arg validators** _(R4.1–4.4)_
  - New pure `server/utils/hledgerArgs.ts`: `isValidDate`, `isValidPeriod`, `isValidAccount` (charset + no leading `-`).
  - New `server/utils/__tests__/hledgerArgs.test.ts` + property test: leading `-`, flag-like (`--debug`), out-of-charset rejected; normal accounts/dates/periods accepted.

- [x] **T8 — Wire validators into read routes** _(R4.1–4.5)_
  - `transactions.get.ts`: validate `startDate`/`endDate`/`account` (`400` on bad), pass `account` after `--`; empty/absent treated as absent.
  - `budget.get.ts`: validate `period` (`400` on bad); empty/absent treated as absent.
  - Route tests in `api-routes.test.ts` (or new file): bad date/period/account → `400` no hledger spawn; valid passes through and account lands after `--`.

- [x] **T9 — Full verification checkpoint** _(NFR3)_
  - `npx nuxi typecheck`: **no new errors from this work.** Pre-existing errors
    remain in untouched files (`utils/toRegisterRows.*`, `toTransactionInput.*`,
    `roundTrip.property.test.ts`, `migration.test.ts`, `pages/accounts/[...path].vue`)
    — a `noUncheckedIndexedAccess` strictness issue that predates this branch and
    is out of scope (and tooling config is hands-off).
  - Full `npx vitest run` green: **36 files passed**. Updated 2 pre-existing
    `api-routes.test.ts` assertions to expect the new `--` separator (R4.3).
  - Updated `AI-MAP.md`: new server utils (`journalFiles`, `hledgerArgs`,
    `activeJournal`), `config/active-journal.json` precedence, input-validation quirks.
  - Legitimate paths still covered by green existing tests (round-trip, budget,
    register, transactions.post).
