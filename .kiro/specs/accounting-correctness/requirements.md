# Requirements — Accounting Correctness

> Traceability: **GitHub Issue #3**. Derived from the approved
> [design.md](./design.md). EARS-style acceptance criteria.

## Glossary

- **Family** — a real account `A` together with its budget sub-accounts
  `A:budget:*` (e.g. `assets:checking` + `assets:checking:budget:*`).
- **Internal move** — a transaction whose net effect on a family is `$0`
  (e.g. budget assignment checking→envelope, transfer between envelopes).
- **Real balance** — the sum of a family's postings = the user's actual account
  balance.

---

## R1 — Real-account register reflects the real balance (Issue #1)

**User story:** As a user viewing an account register, I want the Inflow/Outflow
and Balance columns to reflect real money movement and my actual account
balance, so the register reconciles with the balance shown at the top of the page.

**Acceptance criteria:**
- R1.1 — WHEN building register rows for a real account `A`, THE SYSTEM SHALL
  aggregate the **net** amount across all postings in the family (`A` and
  `A:budget:*`) for each transaction and use that net as the row's inflow
  (net > 0) or outflow (net < 0).
- R1.2 — WHEN a transaction's net family amount rounds to `$0` (an internal
  move), THE SYSTEM SHALL omit it from the register.
- R1.3 — THE SYSTEM SHALL compute `runningBalance` as the cumulative sum of
  per-transaction net family amounts in chronological order, such that the final
  `runningBalance` equals the family real balance.
- R1.4 — WHEN deriving a row's category/payee, THE SYSTEM SHALL use the
  posting(s) outside the family (the expense/income/other-account leg); WHEN
  there is more than one such non-family posting, THE SYSTEM SHALL set the
  category to `Split`.
- R1.5 — WHEN the requested account is itself a budget sub-account (contains
  `:budget:`), THE SYSTEM SHALL preserve per-envelope register behavior (no
  family aggregation beyond that sub-account).
- R1.6 — THE SYSTEM SHALL NOT require a change to the hledger query in
  `transactions.get.ts` for real accounts (existing sub-account match already
  returns the family's transactions).

---

## R2 — "Assigned" derivation uses signed activity (Issue #3)

**User story:** As a user, I want a refund or negative expense to not inflate the
"Assigned" amount, so the budget numbers stay correct.

**Acceptance criteria:**
- R2.1 — WHEN computing period-scoped Assigned, THE SYSTEM SHALL use
  `assigned = periodDelta + activity` with **signed** activity (no `Math.abs`).
- R2.2 — WHEN computing all-time Assigned (no period), THE SYSTEM SHALL use
  `assigned = available + activity` with signed activity.
- R2.3 — WHEN activity for a category is a positive number (refund), THE SYSTEM
  SHALL NOT add a phantom assigned amount (e.g. a $20 refund with no assignment
  yields `assigned = 0`, not `+$40`).
- R2.4 — THE SYSTEM SHALL keep existing outflow-only behavior unchanged (signed
  activity for an outflow equals the prior `+|activity|` result).

---

## R3 — Transfers respect inflow/outflow direction (Issue #4)

**User story:** As a user receiving a transfer into an account, I want it
recorded as money entering that account, not leaving it.

**Acceptance criteria:**
- R3.1 — THE SYSTEM SHALL carry the transfer direction (`in`/`out`) from the
  form to `toTransactionInput` (e.g. via a `direction` field on
  `SimplifiedTransactionInput`).
- R3.2 — WHEN the user fills the **Outflow** column for a transfer, THE SYSTEM
  SHALL post `transferAccount +amount` / `account −amount`.
- R3.3 — WHEN the user fills the **Inflow** column for a transfer, THE SYSTEM
  SHALL post `account +amount` / `transferAccount −amount`.
- R3.4 — THE SYSTEM SHALL leave expense and income posting construction
  unchanged (direction applies to transfers only).
- R3.5 — THE generated transfer postings SHALL always balance to zero.

---

## R4 — Assignment debits the unallocated pool (Issue #5)

**User story:** As a user assigning and un-assigning money, I want assign and
reduce to be exact inverses so my budget can round-trip without drifting.

**Acceptance criteria:**
- R4.1 — WHEN handling `POST /api/budget/assign`, THE SYSTEM SHALL use
  `{physicalAccount}:budget:unallocated` as the balancing (debit) leg instead of
  bare `{physicalAccount}`.
- R4.2 — THE SYSTEM SHALL leave bare `{physicalAccount}` untouched by an
  assignment.
- R4.3 — An assign of `$X` to an envelope followed by a reduce of `$X` from that
  envelope SHALL net to zero change in both the envelope and `unallocated`
  (round-trip).
- R4.4 — THE assignment transaction SHALL remain balanced and SHALL NOT include
  a `= $0.00` balance assertion (per existing journal constraint).
- R4.5 — THE request contract (`date`, `physicalAccount`, `envelopes`) SHALL be
  unchanged.

---

## R5 — Exact-cents money handling (Issue #6)

**User story:** As a user, I want my transactions to always write a balanced
journal hledger accepts, with no precision drift.

**Acceptance criteria:**
- R5.1 — WHEN transforming an hledger amount, THE SYSTEM SHALL derive the
  quantity from `aquantity.decimalMantissa` / `decimalPlaces` when present
  (exact), falling back to `floatingPoint`, then `0`.
- R5.2 — WHEN validating a transaction's balance, THE SYSTEM SHALL compare the
  sum of explicit posting amounts in **integer cents** (zero-sum in cents),
  not a float tolerance.
- R5.3 — FOR any set of posting amounts that sum to zero in cents, `formatTransaction`
  SHALL produce a journal whose written amounts also sum to zero (no divergent
  per-posting rounding).
- R5.4 — THE SYSTEM SHALL NOT introduce a new global money type; output
  formatting remains 2-decimal `$` strings.

---

## R6 — Multi-commodity fails loudly (Issue #7)

**User story:** As a user, I'd rather see a clear error than silently wrong
numbers if an account ever holds two commodities.

**Acceptance criteria:**
- R6.1 — THE SYSTEM SHALL provide a helper that returns the single commodity's
  quantity WHEN exactly one commodity is present.
- R6.2 — WHEN two or more commodities are present, THE server-side helper SHALL
  throw a clear error identifying the account/context (used in `budget.get.ts`
  and balance transforms).
- R6.3 — WHEN two or more commodities are present in a register row (client-side,
  pure), THE SYSTEM SHALL surface a flagged/clearly-marked row rather than
  silently using the first commodity.
- R6.4 — Single-commodity behavior SHALL be unchanged from today.

---

## R7 — Safe delete under journal constraints (Issue #8)

**User story:** As a user deleting a transaction, I want the correct transaction
removed, never a different one.

**Acceptance criteria:**
- R7.1 — WHEN the active journal contains an `include` directive
  (`/^\s*include\s+/m`), THE SYSTEM SHALL reject `DELETE /api/transactions` with
  a clear 4xx error rather than risk deleting the wrong transaction.
- R7.2 — WHEN uploading a journal via `POST /api/journal/upload` whose content
  contains an `include` directive, THE SYSTEM SHALL reject it with a clear 4xx
  error explaining the writable-journal constraint.
- R7.3 — FOR a single flat journal (no includes), delete-by-index behavior SHALL
  be unchanged.
- R7.4 — THE writable-journal "no `include`" constraint SHALL be documented in
  `tech.md` and the design doc.

---

## Non-functional requirements

- NFR1 — All business logic remains in the correct layer (pure functions in
  `utils/`, hledger/journal access only in `server/utils/`); no new layer
  violations (see `separation-of-concerns.md`).
- NFR2 — New/changed pure functions SHALL have unit tests; #1, #3, #4, #6 SHALL
  additionally have fast-check property tests.
- NFR3 — `npm run test` green and `npx nuxi typecheck` clean at completion.
- NFR4 — No `any`/unnecessary `as` to silence the compiler (test mocks excepted);
  no build/test/lint config changes.
- NFR5 — `AI-MAP.md` and `.kiro/steering/hledger-budget-app-design.md` updated to
  reflect the new register semantics and the writable-journal constraint.

## Out of scope

- OOS1 — Full multi-currency support (only a loud guard is added — R6).
- OOS2 — A global decimal/BigInt money type end-to-end (only cents-balancing — R5).
- OOS3 — Delete via hledger source locations (only the `include` guard — R7).
- OOS4 — Issue #9 (category-delete no-op, `groupKey = segments[1]` UX) — proposed
  as a separate follow-up issue.
- OOS5 — Re-architecting assignment vs spending into distinct sub-accounts
  (the root cause noted under #3); only the signed-activity fix is made.
- OOS6 — Migrating historical journals created by the old assign flow (#5).
