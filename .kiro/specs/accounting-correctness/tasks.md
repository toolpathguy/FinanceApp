# Tasks — Accounting Correctness

> Traceability: **GitHub Issue #3**. Implements [design.md](./design.md) and
> satisfies [requirements.md](./requirements.md). Branch: `fix/accounting-correctness`.
> Work tasks top-to-bottom; after each, run the cited tests + mark `- [x]`.
> Each task is independent except where noted (T6 before T7; T1 before T2).

---

- [x] **T1 — Exact-cents money boundary & validation (R5)**
  - `server/utils/hledger.ts`: rewrite `transformAmount` to derive quantity from
    `aquantity.decimalMantissa` / `decimalPlaces` (exact `mantissa / 10**places`)
    when present, falling back to `floatingPoint`, then `0`.
  - `server/utils/journalWriter.ts`: change `validateTransaction` Rule 5 to sum
    explicit amounts in integer cents (`Math.round(x*100)`) and require the cents
    sum to be `0` (drop the `0.001` float tolerance).
  - Tests: extend `server/utils/journalWriter.test.ts` (cents-sum balance cases)
    + new `server/utils/journalWriter.property.test.ts` (fast-check: random
    posting sets summing to zero in cents always format to a balanced journal —
    **R5.3**). Add a `transformAmount` unit test for the mantissa path.
  - Covers: R5.1, R5.2, R5.3, R5.4.
  - Verify: `npx vitest run server/utils/journalWriter.test.ts server/utils/journalWriter.property.test.ts`

- [x] **T2 — `singleQuantity` guard helper (R6)** *(after T1)*
  - New `utils/singleQuantity.ts`: `singleQuantity(amounts, context)` → returns
    the lone quantity; throws a clear error naming `context` when ≥2 commodities;
    returns `0` for empty.
  - Wire into `server/api/budget.get.ts` (activity, budget balances, real
    balance reads) and the balance transform consumers where `amounts[0]` is
    used server-side.
  - `utils/toRegisterRows.ts` (client/pure): flag a row when a family posting has
    ≥2 commodities rather than throw (handled in T3; note the dependency).
  - Tests: `utils/singleQuantity.test.ts` (one/zero/many cases).
  - Covers: R6.1, R6.2, R6.4. (R6.3 finished in T3.)
  - Verify: `npx vitest run utils/singleQuantity.test.ts server/api/__tests__/budget.get.test.ts`

- [x] **T3 — Family-aggregate register (R1, R6.3)**
  - Rewrite `utils/toRegisterRows.ts`: for the requested `accountPath`, sum the
    **net** of all family postings (`p.account === path || startsWith(path+':')`)
    per transaction; net>0 → inflow, net<0 → outflow; skip when net rounds to $0
    (internal move); running balance = cumulative net. Derive category/payee from
    non-family postings (≥2 → `Split`). If `accountPath` contains `:budget:`,
    keep single-sub-account behavior (R1.5). Multi-commodity family posting →
    flagged row (R6.3).
  - Confirm `server/api/transactions.get.ts` needs no query change (R1.6).
  - Tests: rewrite `utils/toRegisterRows.test.ts` (rent/gas/income/transfer nets,
    internal-move drop, split, per-envelope path) + new
    `utils/toRegisterRows.property.test.ts` (final runningBalance == family net
    sum — **R1.3**).
  - Covers: R1.1–R1.6, R6.3.
  - Verify: `npx vitest run utils/toRegisterRows.test.ts utils/toRegisterRows.property.test.ts`

- [x] **T4 — Signed Assigned derivation (R2)**
  - `server/api/budget.get.ts`: replace `periodDelta + Math.abs(activity)` and
    `available + Math.abs(activity)` with signed `activity`; add a comment with
    the `delta = assigned − spent` identity.
  - Tests: extend `server/api/__tests__/budget.get.test.ts` with a refund
    (positive activity) case asserting no phantom assigned (R2.3) and an
    outflow case asserting unchanged result (R2.4).
  - Covers: R2.1–R2.4.
  - Verify: `npx vitest run server/api/__tests__/budget.get.test.ts`

- [x] **T5 — Transfer direction (R3)**
  - `types/ui.ts`: add `direction?: 'in' | 'out'` to `SimplifiedTransactionInput`.
  - `utils/toTransactionInput.ts`: in `formStateToInput`, set
    `direction = state.inflow ? 'in' : 'out'` for transfers; in
    `toTransactionInput`, orient transfer legs by `direction` (R3.2/R3.3).
  - Tests: extend `utils/toTransactionInput.test.ts` (inflow + outflow transfer
    cases, both balance — R3.5) + property test that transfer legs always sum to
    zero for both directions.
  - Covers: R3.1–R3.5.
  - Verify: `npx vitest run utils/toTransactionInput.test.ts`

- [x] **T6 — Assign debits unallocated (R4)**
  - `server/api/budget/assign.post.ts`: change the balancing leg from bare
    `body.physicalAccount` to `toUnallocatedAccount(body.physicalAccount)`
    (import from `utils/budgetAccounts`). Keep request contract + no balance
    assertion.
  - Tests: extend/`add` `server/api/budget/__tests__/assign.post.test.ts` —
    assert the debit posting targets `…:budget:unallocated`, bare account
    untouched, and an assign+reduce round-trips to zero (R4.3) when paired with
    the existing transfer endpoint shape.
  - Covers: R4.1–R4.5.
  - Verify: `npx vitest run server/api/budget/__tests__/assign.post.test.ts`

- [x] **T7 — `include` guard on delete + upload (R7)**
  - `server/api/transactions.delete.ts`: after reading the journal, if
    `/^\s*include\s+/m` matches, throw a clear 4xx before computing the delete
    range (R7.1).
  - `server/api/journal/upload.post.ts`: reject uploaded content containing an
    `include` directive with a clear 4xx (R7.2).
  - Tests: `server/api/__tests__/transactions.delete.test.ts` (reject-with-include,
    flat-journal unchanged — R7.3) and an upload guard test.
  - Covers: R7.1–R7.3.
  - Verify: `npx vitest run server/api/__tests__/transactions.delete.test.ts server/api/journal/__tests__/upload.post.test.ts`

- [x] **T8 — Docs & map (R7.4, NFR5)**
  - `tech.md` + `.kiro/steering/hledger-budget-app-design.md`: document the
    new family-aggregate register semantics (Account Register Display section)
    and the writable-journal "no `include`" constraint.
  - `AI-MAP.md`: note the new `utils/singleQuantity.ts`, the register-semantics
    change, and the `include` constraint (main agent owns map updates).
  - Covers: R7.4, NFR5.

- [x] **T9 — Full verification checkpoint (NFR2, NFR3, NFR4)**
  - `npm run test` — **all 32 files / 287 tests green.**
  - `npx nuxi typecheck` — **all production code touched by this branch is
    clean.** Two classes of pre-existing failures remain on `main` and are NOT
    introduced here: (1) one production error in `pages/accounts/[...path].vue:106`
    (untouched file); (2) widespread `noUncheckedIndexedAccess` noise in existing
    `*.test.ts` files (the repo's established test idiom — `const [row] = …; row.x`).
    New test files added here are typecheck-clean; additions to existing test
    files follow their surrounding convention. A repo-wide test-typing cleanup is
    out of scope for this fix.
  - No `any`/`as any`/config changes introduced; layer boundaries preserved
    (pure helpers in `utils/`, hledger/journal access only in `server/utils`).
  - PR body must start with `Fixes #3`.

---

### Coverage matrix

| Requirement | Task |
|---|---|
| R1 | T3 |
| R2 | T4 |
| R3 | T5 |
| R4 | T6 |
| R5 | T1 |
| R6 | T2 (+R6.3 in T3) |
| R7 | T7, T8 (docs) |
| NFR1–5 | spread; T8 (docs/map), T9 (test/typecheck) |
