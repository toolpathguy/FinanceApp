# Requirements — Server Robustness (GitHub Issue #4)

Derived from the approved `design.md`. Acceptance criteria use EARS
("WHEN … THE SYSTEM SHALL …") form. Each requirement maps to a design item.

---

## R1 — hledger process never hangs the request (Issue #4 item 1)

**User story:** As an operator, when hledger is missing, broken, or hung, I want
the request to fail fast with an error rather than hang forever, so the server
stays responsive.

- **R1.1** WHEN `hledger` cannot be spawned (e.g. `ENOENT`, not on PATH) THE
  SYSTEM SHALL reject the call with an `Error` whose message identifies a
  start/spawn failure, rather than leaving the promise unsettled.
- **R1.2** WHEN an hledger process runs longer than `HLEDGER_TIMEOUT_MS`
  (default 30000) THE SYSTEM SHALL terminate the process and reject with a
  timeout `Error`.
- **R1.3** WHEN the spawn `error` event fires after the process has already
  closed (or vice-versa) THE SYSTEM SHALL settle the promise exactly once (no
  double-resolve/reject, no late timer firing).
- **R1.4** WHEN any of `hledgerExec` / `hledgerExecText` / `addTransaction`
  rejects THE SYSTEM SHALL surface it as an HTTP 500 from the calling Nitro route
  (existing default behavior), except where the route already maps engine errors
  to a 4xx for validation.
- **R1.5** THE SYSTEM SHALL preserve existing success behavior: a zero exit code
  returns parsed JSON (`hledgerExec`) / raw text (`hledgerExecText`); a non-zero
  exit code throws with stderr (unchanged).

---

## R2 — Amount validated as a positive finite number (Issue #4 item 2)

**User story:** As a user submitting a simplified transaction, I want a clear
rejection of malformed or non-positive amounts, so a bad amount never silently
inverts or zeroes a posting.

- **R2.1** WHEN a simplified transaction is posted with `amount` that is not a
  number, or is `NaN`/`Infinity` THE SYSTEM SHALL respond `400` with a message
  indicating the amount must be a positive number.
- **R2.2** WHEN `amount <= 0` (zero or negative) THE SYSTEM SHALL respond `400`
  with the same positive-number message.
- **R2.3** WHEN `amount` is a finite number `> 0` and other required fields are
  present THE SYSTEM SHALL proceed to build and append the transaction (unchanged
  happy path, `201`).
- **R2.4** WHEN required fields `date`, `payee`, or `account` are missing THE
  SYSTEM SHALL respond `400` "Missing required fields" (the amount check is
  separate from the presence check so the two reasons are distinguishable).
- **R2.5** THE SYSTEM SHALL leave the legacy (`description` + `postings`) input
  branch behavior unchanged.

---

## R3 — Budget base derived, not hardcoded (Issue #4 item 3)

**User story:** As a user whose primary asset account is not literally
`assets:checking`, I want envelope routing and the budget report to work against
my actual account, so credit-card expenses and the budget page are correct.

- **R3.1** THE SYSTEM SHALL provide `resolveBudgetBase(allAccounts?)` that
  returns the asset account hosting the envelope tree — the path before
  `:budget:` on the first matching `assets:*` account.
- **R3.2** WHEN no asset account contains `:budget:` (fresh journal) THE SYSTEM
  SHALL return `DEFAULT_BUDGET_BASE` (`assets:checking`).
- **R3.3** WHEN a credit-card (liability) simplified expense is posted THE SYSTEM
  SHALL use the resolved budget base for the budget-credit and pending postings
  instead of a hardcoded `assets:checking`.
- **R3.4** WHEN building the budget report THE SYSTEM SHALL query and key budget
  sub-accounts off the resolved base (`` `${base}:budget:` ``), including the
  `unallocated` and `pending:` special cases.
- **R3.5** WHEN `budget.get.ts` has already fetched the account list THE SYSTEM
  SHALL derive the base from that list without issuing an additional `accounts`
  call.
- **R3.6** THE SYSTEM SHALL keep existing journals working unchanged: a journal
  whose base is `assets:checking` SHALL produce byte-for-byte the same postings
  and the same budget numbers as before.

---

## R4 — Date-filtered register shows true running balance (Issue #4 item 4)

**User story:** As a user filtering an account register by start date, I want the
Balance column to reflect the account's real balance, not a balance that resets
to $0 at the window start.

- **R4.1** THE SYSTEM SHALL accept an optional `openingBalance` (default `0`) in
  `toRegisterRows` and start the running balance from it.
- **R4.2** WHEN a register is requested with a `startDate` and an `account` THE
  SYSTEM SHALL seed the opening balance from `hledger bal -e <startDate> -- <account>`
  (the family balance strictly before the window).
- **R4.3** WHEN no `startDate` is supplied THE SYSTEM SHALL use opening balance
  `0` (running balance is correct over full history, unchanged).
- **R4.4** THE SYSTEM SHALL pass the account query through the existing
  injection-safe `--` path and existing `isValidAccount` validation for the seed
  query.
- **R4.5** THE SYSTEM SHALL keep all existing `toRegisterRows` callers and tests
  working unchanged (the new parameter is optional with a `0` default).

---

## R5 — Buffer-safe output and async existence checks (Issue #4 item 5)

**User story:** As a maintainer, I want stream output decoded safely and request
handlers free of synchronous IO, so multi-byte output can't corrupt and the event
loop isn't blocked.

- **R5.1** THE SYSTEM SHALL collect hledger stdout/stderr as buffered chunks and
  decode once via `Buffer.concat(...).toString('utf8')`, never via `string += Buffer`.
- **R5.2** THE SYSTEM SHALL provide an async `pathExists(path)` helper and use it
  in place of `existsSync` in `budget.get.ts`, `hidden-envelopes.post.ts`, and
  `journal/activate.post.ts`.
- **R5.3** THE SYSTEM SHALL NOT change `activeJournal.ts`'s intentional
  synchronous read (out of scope; on a sync hot path).

---

## Non-functional requirements

- **NFR1 — Layering:** All changes respect `separation-of-concerns.md` — process
  spawning and `:budget:` derivation stay in `server/utils`; validation stays in
  `server/api`; running-balance seeding logic stays pure in `utils/` (the route
  only supplies the seed value).
- **NFR2 — No config/tooling changes:** No edits to `tsconfig`, `vitest.config`,
  `nuxt.config`, lint, or `package.json` scripts to make checks pass.
- **NFR3 — Windows/CRLF:** Any new line-splitting uses `split(/\r?\n/)` + trim.
- **NFR4 — Type safety:** No new `any`/`as any`; `as` only at validated
  boundaries. `npx nuxi typecheck` clean.
- **NFR5 — Guard test intact:** The existing "hledger.ts must not import `fs`"
  property test SHALL still pass (`resolveBudgetBase` uses hledger, not `fs`).
- **NFR6 — Tests:** `npx vitest run` passes; new tests cover each of R1–R5.

---

## Out of scope (explicit)

- Settings UI / persisted config for the primary/budget-base account (see #7).
- Multi-account envelope backing / negative-unallocated UX (tracked in **#7**).
- Full multi-commodity register support (single-`$` assumption retained).
- Converting `activeJournal.ts` to async.
- Credit-card-first expense on a non-default base before any budget tree exists
  (residual gap; falls back to `assets:checking`).
