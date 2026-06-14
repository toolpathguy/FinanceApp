# Design — Accounting Correctness

> Traceability: implements **GitHub Issue #3** (toolpathguy/FinanceApp,
> "Accounting correctness: register pollution, fragile Assigned derivation,
> transfer direction, float money"). Verified against hledger 1.50. The PR that
> closes this spec must begin its body with `Fixes #3`.

## 1. Problem framing

A deep dive into the envelope accounting model surfaced a cluster of correctness
bugs. They share one root cause: **the physical account and its budget
sub-accounts (`assets:checking:budget:*`) are conflated**, and several derived
values are reverse-engineered with sign-losing heuristics (`Math.abs`,
`amounts[0]`, float quantities).

The journal invariant (confirmed against `test-data/sample.journal` + hledger
1.50): bare `assets:checking` is kept at `$0`; every real dollar lives in a
`assets:checking:budget:*` sub-account. The user's *actual* checking balance is
therefore the **sum of the budget sub-accounts**, not bare checking. Any code
that treats `assets:checking` as "the account" either pulls in the budget layer
by accident (sub-account matching) or reads a meaningless `$0`.

This spec fixes the correctness defects without re-architecting the envelope
model. Items #2 (retracted) needs no code change.

## 2. Scope

Issue #3 is an umbrella. Proposed split — **confirm or adjust at this gate**:

**In scope (core correctness + data integrity):**
- **#1** Real-account register polluted by budget sub-accounts *(high)*
- **#3** "Assigned" reverse-derivation breaks on inflows/refunds *(medium-high)*
- **#4** Transfer direction ignores inflow/outflow *(medium)*
- **#5** UI assignment debits bare checking, not the unallocated pool *(medium)*
- **#6** Money handled as floats with per-posting rounding *(medium)*

**In scope (cheap safety guards, not full features):**
- **#7** Multi-commodity silently dropped → **detect & surface** (guard/throw),
  not full multi-currency support (that's a separate feature).
- **#8** Delete-by-index can remove the wrong transaction → **forbid `include`
  in the writable journal + guard**, not a source-location rewrite.

**Deferred (propose moving to a follow-up issue):**
- **#9** Category "delete" no-op and `groupKey = segments[1]` UX oddity — real
  but tangential to accounting correctness. Small; can fold in if you want it.

**#2** — retracted (hledger `bal` defaults to flat; no double-count). Optional
hardening: an integration test asserting flat-mode rows. Tracked under #6/#7
test work, not its own task.

## 3. Per-issue design

### #1 — Real-account register pollution (high)

**Root cause.** Two layers both sub-account-match `assets:checking`:
- `server/api/transactions.get.ts` passes `account` straight to
  `hledger print assets:checking`, which matches `assets:checking:budget:*` too.
- `utils/toRegisterRows.ts` matches `p.account === path || startsWith(path+':')`,
  so for `assets:checking` it grabs budget-layer postings.

**Key design question.** Once budget postings are excluded, what *should* the
checking register show? Bare checking is `$0` and barely moves, so a literal
"drop `:budget:` postings" leaves an almost-empty, useless register.

Two options:

- **Option A (recommended) — account-aggregate register.** Treat the register
  for a real account `A` as the *account family* `A` + `A:budget:*`. For each
  transaction, sum the net change across all postings in the family; that net is
  the row's inflow/outflow, and the running balance tracks the **real bank
  balance** (sum of bare + envelopes). Pure internal moves (assignments:
  checking→budget, transfers between envelopes) net to `$0` and are dropped from
  the register. Category for the row is derived from the non-family posting
  (the expense/income/other-account leg). This is the YNAB behavior: the account
  register shows real money movements; budget assignments are budget-side, not
  account-side. Matches the verified sample (rent −1200, gas −X, transfer −500,
  income +2000; CC expense nets $0 to checking because food→pending-CC is
  internal).
- **Option B — exclude `:budget:` only (issue's literal suggestion).** Simpler,
  but the checking register then shows only bare-checking movements (near-empty,
  balance pinned at $0). Rejected as the default because it's not useful, though
  it is the smaller change.

**Chosen: Option A.** Implementation:
- New pure helper `utils/toRegisterRows.ts` reworked to be *family-aware*:
  `isFamilyPosting(p, accountPath)` = `p.account === accountPath ||
  p.account.startsWith(accountPath + ':')`. Sum family postings → `netAmount`.
  Skip the transaction when `netAmount` rounds to `0` (internal-only) **unless**
  it is the only thing in the tx (defensive). Derive category/payee from the
  non-family postings.
- Guard the query in `transactions.get.ts`: when the requested `account` is a
  real (non-`:budget:`) account, we still want hledger to return any tx touching
  the family, which the current sub-account match already does — so **no query
  change needed** for Option A; the aggregation happens in `toRegisterRows`.
  (If we'd picked Option B we'd anchor the query regex.)
- Edge cases: multi-leg expense (split) — with aggregation the family net is a
  single number, so the old `Split` special-case is replaced by net-based rows;
  a true split across two *non-family* categories still shows one net row with
  category `Split`.

**Files:** `utils/toRegisterRows.ts` (rewrite), `utils/toRegisterRows.test.ts` +
new `*.property.test.ts`. No API change.

### #3 — "Assigned" derivation drops sign (medium-high)

**Root cause.** `server/api/budget.get.ts`:
```ts
assigned = periodDelta + Math.abs(activity)   // period
assigned = available  + Math.abs(activity)    // no period
```
Identity: budget sub-account `delta = assigned − spent`, and `spent = activity`
(signed: outflow is negative). So `assigned = delta + activity` (signed). The
`Math.abs` is only correct while activity is always an outflow; a refund
(positive activity) yields a phantom assignment (a $20 refund shows +$40).

**Fix.** Drop `Math.abs`, use signed `activity`:
```ts
assigned = (period ? periodDelta : available) + activity
```
Document the identity in a comment. This is the minimum fix; the architectural
root (assignment & spending share one sub-account, so "assigned this period" is
always inferred) is noted in the design doc as a known limitation, not fixed
here.

**Files:** `server/api/budget.get.ts`, `server/api/__tests__/budget.get.test.ts`
(add refund/negative-activity cases).

### #4 — Transfer direction ignores inflow/outflow (medium)

**Root cause.** `utils/toTransactionInput.ts` always builds a transfer as
`transferAccount +amount` / `account −amount` — money always leaves the current
account. `formStateToInput` collapses inflow/outflow into one positive `amount`,
losing which column the user filled, and `deriveTransactionType` returns
`transfer` regardless of direction.

**Fix.** Thread the direction through:
- Add `direction?: 'in' | 'out'` to `SimplifiedTransactionInput` (types/ui.ts).
- `formStateToInput`: for a transfer, set `direction = state.inflow ? 'in' : 'out'`.
- `toTransactionInput`: for a transfer, orient legs by direction —
  `out` → `transferAccount +amount`, `account −amount` (current behavior);
  `in`  → `account +amount`, `transferAccount −amount`.
- Non-transfer types ignore `direction`.

**Files:** `types/ui.ts`, `utils/toTransactionInput.ts`,
`utils/toTransactionInput.test.ts` (add inflow-transfer cases).

### #5 — Assignment debits bare checking, not the unallocated pool (medium)

**Root cause.** `pages/budget.vue` `saveAssignment`: increase → `POST
/api/budget/assign` which debits bare `assets:checking`; decrease → `POST
/api/budget/transfer` crediting `…:budget:unallocated`. Assign and reduce aren't
inverses, so bare checking drifts negative and `unallocated` drifts positive —
breaking the `bare checking = $0`, `unallocated = the pool` invariant; an
assign→reduce can't round-trip.

**Fix.** Assign should move money **from the unallocated pool**, symmetric with
reduce. Change `server/api/budget/assign.post.ts` so the balancing (debit) leg
is `${physicalAccount}:budget:unallocated` (via `toUnallocatedAccount`) instead
of bare `physicalAccount`. Then assign (unallocated → envelope) and reduce
(envelope → unallocated) are exact inverses and bare checking is untouched.
- `pages/budget.vue` keeps calling `/api/budget/assign` for increases; no UI
  change required beyond verifying the request body (already sends
  `physicalAccount`).
- Keep `physicalAccount` in the request (used to derive the budget root); only
  the leg target changes.

**Files:** `server/api/budget/assign.post.ts`,
`server/api/budget/__tests__/assign.post.test.ts`. Note in design doc that
income still lands in bare checking and a separate "assign all income" flow may
seed `unallocated`; out of scope here.

### #6 — Float money with per-posting rounding (medium)

**Root cause.** `server/utils/hledger.ts` `transformAmount` reads
`aquantity.floatingPoint`; `server/utils/journalWriter.ts` `formatTransaction`
rounds each posting with `toFixed(2)`. Divergent rounding can write an
unbalanced journal that hledger rejects; general precision loss elsewhere.

**Fix (contained, no new money type).**
- `transformAmount`: derive quantity from `aquantity.decimalMantissa` /
  `decimalPlaces` (exact: `mantissa / 10**places`) when present, falling back to
  `floatingPoint` then raw. This removes the binary-float read at the boundary.
- `formatTransaction`: keep `toFixed(2)` for output formatting (hledger journals
  are 2-dp here) but compute amounts in **integer cents** when balancing so the
  written postings are guaranteed to sum to zero. Concretely: round each amount
  to cents once, and let the validator check the cents-sum is zero.
- `validateTransaction`: tighten Rule 5 to compare in integer cents
  (`Math.round(x*100)`) rather than a `0.001` float tolerance, so "balanced in
  cents" is the contract.
- Full decimal/BigInt money type is **out of scope** (larger refactor); this
  removes the concrete "unbalanced journal" failure mode and the boundary
  float read.

**Files:** `server/utils/hledger.ts`, `server/utils/journalWriter.ts`,
`server/utils/journalWriter.test.ts` (+ property test: random posting sets that
sum to zero in cents always format to a balanced journal).

### #7 — Multi-commodity silently dropped (medium) → guard

**Root cause.** `amounts[0]` / `amounts?.[0]?.quantity` everywhere assumes a
single commodity. The app is `$`-only by design, so full multi-currency is a
separate feature — but silent truncation is a data-correctness trap.

**Fix.** Add a guard rather than support: a small helper
`singleQuantity(amounts, context)` in `server/utils/` (or `utils/`) that returns
`amounts[0].quantity` when there is exactly one commodity and **throws/logs a
clear error** when there are 2+. Use it in the hot paths (`budget.get.ts`,
balance transforms). `toRegisterRows` (pure, client-facing) surfaces a flagged
row instead of throwing. Net: multi-commodity data fails loudly instead of
showing wrong numbers.

**Files:** new `utils/singleQuantity.ts` (+ test), wired into `budget.get.ts`
and the balance transform path.

### #8 — Delete-by-index can delete the wrong transaction (medium) → guard

**Root cause.** `server/api/transactions.delete.ts` counts date-line matches to
locate transaction N, while the register deletes by hledger `tindex`. These
coincide for a single flat file but diverge when the journal uses `include`
directives (`resolveJournalPath` reads only the master file). `journal/upload`
lets a user supply an arbitrary journal, so this is a latent risk.

**Fix (guard, not rewrite).**
- On delete, after reading the journal, **reject with a clear 422** if the file
  contains an `include` directive (`/^\s*include\s+/m`) — we cannot safely map
  `tindex` to a line range across includes. Document the writable-journal
  constraint (no `include`) in the design doc and `tech.md`.
- Optionally also enforce at `journal/upload` (reject uploads containing
  `include`) so the constraint is established at the boundary, not just at
  delete. Propose: validate on upload **and** guard on delete (defense in depth).
- A full fix (delete via hledger source positions) is the larger alternative,
  recorded under "Alternatives".

**Files:** `server/api/transactions.delete.ts`, `server/api/journal/upload.post.ts`,
their `__tests__`.

## 4. Cross-cutting: tests & verification

- Unit + property tests live beside source (`*.test.ts`, `*.property.test.ts`).
- Property tests (fast-check) for: register aggregation nets correctly (#1),
  signed-assigned identity holds for arbitrary delta/activity (#3), transfer
  legs balance for both directions (#4), cents-balanced postings always format
  to a balanced journal (#6).
- API route tests mock Nitro globals via `vi.stubGlobal()` (existing pattern).
- Final checkpoint: `npm run test` green + `npx nuxi typecheck` clean.

## 5. Alternatives considered

- **#1 Option B (exclude `:budget:` only):** smaller, but near-empty register.
  Rejected — see #1.
- **#6 full decimal money type (BigInt cents end-to-end):** correct long-term,
  but a broad refactor touching every amount path. Deferred; the cents-balancing
  guard removes the concrete failure mode now.
- **#7 full multi-currency support:** large feature; the app is `$`-only.
  Deferred in favor of a loud guard.
- **#8 delete via hledger source locations:** robust against `include`, but
  needs parsing hledger's source-position output and a larger delete rewrite.
  Deferred in favor of forbidding `include` in the writable journal.

## 6. Risks / notes

- #1 Option A changes register semantics (running balance now = real bank
  balance, internal moves drop out). This is the *intended* YNAB behavior but is
  a visible behavior change — call it out in the PR and update the design doc's
  "Account Register Display" section.
- #5 changes where assigned money is debited; existing journals created by the
  old assign flow have already debited bare checking. No migration is performed;
  document that historical drift may exist (Ready-to-Assign math still nets out
  because it sums real balances minus envelopes).
- After implementation, update `AI-MAP.md` and the design doc
  (`.kiro/steering/hledger-budget-app-design.md`) in one pass (main agent owns
  map updates).
