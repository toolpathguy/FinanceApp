# Tasks — Enforce budget availability (no assigning money you don't have)

> Traceability: **GitHub Issue #7**. Implements [design.md](./design.md),
> satisfies [requirements.md](./requirements.md). Implement top-to-bottom, one at
> a time; check off and report verification after each.

- [x] **T1 — Extract `getReadyToAssign()` into a shared server util**
  Add `server/utils/budgetData.ts` exporting `getReadyToAssign(): Promise<number>`
  (net real balance from `bal assets: liabilities:` minus sum of non-unallocated
  budget sub-accounts, using `resolveBudgetBase`) and `READY_TO_ASSIGN_EPSILON =
  0.005`. Mirror the existing math in `budget.get.ts:94-113` exactly.
  _Covers: AC-4, AC-12, NFR-1, NFR-2. Files: `server/utils/budgetData.ts`._

- [x] **T2 — Refactor `budget.get.ts` to use the shared util**
  Replace the inline RTA computation with a call to `getReadyToAssign()`. No
  change to the returned `readyToAssign` value or other figures.
  _Covers: AC-12. Files: `server/api/budget.get.ts`._

- [x] **T3 — Add the availability gate to `assign.post.ts`**
  Before `appendTransaction`, compute `available = await getReadyToAssign()`.
  If `totalAssigned > available + READY_TO_ASSIGN_EPSILON`, throw a 400 with
  message `Can't assign $<requested> — only $<available> left to assign.`
  (2-dp formatted). Otherwise proceed unchanged.
  _Covers: AC-1, AC-2, AC-3, AC-4. Files: `server/api/budget/assign.post.ts`._

- [x] **T4 — Gate tests: over-assignment rejected, within-budget accepted**
  `server/api/__tests__/budget-assign.test.ts` (new or extend existing), Nitro
  globals via `vi.stubGlobal()`:
  - **Over-assign vs net worth → rejected (the requested scenario):** stub
    hledger so net worth = $1,000 and envelopes already total such that RTA =
    $380; assign $500 → expect 400, message names $500 and $380, and
    `appendTransaction` is **not** called. (AC-1, AC-2, AC-7)
  - **Within budget → accepted:** assign ≤ RTA → 201, `appendTransaction` called
    once. (AC-3)
  - **Exact-budget boundary → accepted** (epsilon). (AC-3)
  _Covers: AC-1, AC-2, AC-3, AC-7. Files:
  `server/api/__tests__/budget-assign.test.ts`._

- [x] **T5 — Gate test: savings-backed assignment accepted (State B)**
  In the same suite: stub hledger so checking = $0 but savings makes net worth
  cover the assignment (RTA sufficient); assign → **accepted** (201), proving the
  gate is net-worth-based, not host-account-based.
  _Covers: AC-5, AC-6, AC-8. Files:
  `server/api/__tests__/budget-assign.test.ts`._

- [x] **T6 — Client-side over-assign guard in `pages/budget.vue`**
  In `saveAssignment`, when `delta > 0` and `delta > budget.readyToAssign +
  0.005`, toast "Only $X left to assign" and abort before the request. Keep the
  existing error toast so a server 400 still surfaces. No RTA math beyond the
  comparison.
  _Covers: AC-11, NFR-1. Files: `pages/budget.vue`._

- [x] **T7 — Confirm overspending & transfers remain unrestricted**
  Verify (and add a focused assertion if not already covered) that
  `transfer.post.ts` is not gated and that spending can drive an envelope negative
  — no code change expected; document the confirmation in the task report.
  _Covers: AC-9, AC-10. Files: (verification; `server/api/__tests__/` if an
  assertion is added)._

- [x] **T8 — Document the model decision**
  In `.kiro/steering/hledger-budget-app-design.md` (under *Budget Page* /
  *Envelope Account Structure*) add the "Budget availability & single-host model
  (decision, Issue #7)" note per AC-13.
  _Covers: AC-13. Files: `.kiro/steering/hledger-budget-app-design.md`._

- [x] **T9 — Update `AI-MAP.md`**
  Add a `server/utils/budgetData.ts` row (shared RTA util) to the server-utils
  listing. Main agent only.
  _Covers: map upkeep. Files: `AI-MAP.md`._

- [x] **T10 — Verification checkpoint**
  Run `npx vitest run server/api/__tests__/budget-assign.test.ts` (new gate tests
  green), then full `npm run test` and `npx nuxi typecheck` — all pass. Report
  results.
  _Covers: NFR-3, NFR-4._

## Notes
- **The requested test** (assigned totals > net worth ⇒ rejected) is T4, first
  bullet; AC-8/T5 is its accepted counterpart that proves savings counts.
- The RTA badge keeps its existing red-for-negative styling as a defensive
  fallback; no dedicated presentation helper is needed now that over-assignment is
  prevented at the source.
