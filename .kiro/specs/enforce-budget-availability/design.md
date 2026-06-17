# Design — Enforce budget availability (no assigning money you don't have)

> Traceability: implements **GitHub Issue #7** ("Envelopes physically backed by a
> non-host account — e.g. budget in an envelope, money kept in savings").
> Relates to #4 (Item 3 generalized the budget host via `resolveBudgetBase` but
> kept the single-host model — `server/api/budget.get.ts:44-49`).
>
> **Scope pivot (post-design discussion):** the original draft treated this as a
> presentation-only "show a negative Ready-to-Assign nicely" change. The product
> owner clarified the intended model: **you should not be able to assign money to
> an envelope that doesn't exist.** Overspending an *envelope* stays allowed
> (covered by moving funds between envelopes); over-*assigning* from the pool is
> prevented. This design reflects that model.

## The budgeting model (as clarified)

- Money enters as an **inflow to a real account** (e.g. checking) and lands in the
  **Ready-to-Assign pool**. Where the cash physically sits is irrelevant to how
  much you can assign — savings counts too.
- **Ready to Assign (RTA) = net real balance (all assets + liabilities) − sum of
  envelope balances.** This is the "money that actually exists and isn't yet
  earmarked." Already computed correctly in `budget.get.ts:104-113`.
- **Assigning** moves money from the RTA pool into an envelope. You may assign up
  to RTA and **no more** — you can't budget money that doesn't exist.
- **Spending** debits an expense and credits the envelope. Spending more than an
  envelope holds drives that envelope's **Available negative (overspending)** —
  this **is allowed**. RTA is unchanged by spending (cash and envelope both drop
  by the same amount).
- **Covering overspending** = move funds from another envelope into the overspent
  one via a **budget transfer** (`budget/transfer.post.ts`). Transfers are
  unrestricted — they reshuffle already-existing money, they don't create it.

The pool (RTA) is the single "does this money exist?" gate. Envelopes may go
negative (overspending); the pool may not be over-drawn (over-assigning).

## Problem framing

1. **No availability gate on assignment (the core fix).** `assign.post.ts`
   appends the assignment unconditionally — it never checks that RTA covers it.
   So the UI lets you assign money you don't have, producing a negative RTA /
   confusing state. We add a **server-side availability check**.
2. **State B is correct and must keep working.** Assigning money that physically
   lives in savings (host account = checking holds $0) is legitimate: RTA counts
   savings, so the assignment is within budget. The check must be against **RTA
   (net worth)**, never against the host account's cash — otherwise we'd break the
   exact scenario Issue #7 is about. A side effect is a negative
   `…:budget:unallocated` sub-account; that is numerically correct and stays
   invisible (documented, not surfaced).
3. **The model decision is undocumented.** Single-host + money-can-be-anywhere,
   and "negative unallocated is fine," need to be written down (Issue #7's second
   ask). Multi-account envelope hosting is explicitly **not** a goal.

## Proposed solution

### 1. Extract the RTA computation to a shared server util (one source of truth)

`server/utils/budgetData.ts` — new `getReadyToAssign()` that performs the two
hledger reads and returns the current RTA number. `budget.get.ts` is refactored
to call it (no behavior change there); `assign.post.ts` calls it to gate writes.
This avoids duplicating accounting logic across two endpoints
(`separation-of-concerns.md`: accounting math has one home; server utils own
hledger access).

```ts
// server/utils/budgetData.ts
/** YNAB Rule 1 pool: net real balance (assets + liabilities) − sum of envelopes. */
export async function getReadyToAssign(): Promise<number>
```

### 2. Gate assignment server-side in `assign.post.ts`

Before `appendTransaction`, compute `available = await getReadyToAssign()`. If
`totalAssigned > available + EPSILON` (half a cent), reject:

```
400  "Can't assign $500.00 — only $380.00 left to assign."
```

- The check is on the **global pool**, independent of `physicalAccount` — savings
  money counts. State B (savings-backed assignment) passes.
- `EPSILON = 0.005` absorbs float drift so an exactly-affordable assignment isn't
  rejected by a rounding hair.
- **Only assignment is gated.** `transfer.post.ts` (envelope↔envelope, incl.
  reduce-to-unallocated) stays unrestricted — that's how overspending is covered
  and how assignments are walked back.

### 3. UI guard + messaging in `pages/budget.vue`

The inline-assign flow (`saveAssignment`) computes a positive `delta` when
raising an assignment. Add an instant client-side check: if
`delta > budget.readyToAssign + EPSILON`, show a friendly toast ("Only $X left to
assign") and don't fire the request. The **server remains the source of truth** —
a rejected request still surfaces its message via the existing error toast. The
RTA badge keeps its red treatment as a defensive fallback (RTA shouldn't go
negative through normal flow once gated, but legacy/manual journals might).

### 4. Document the model decision

`.kiro/steering/hledger-budget-app-design.md` (under *Budget Page* / *Envelope
Account Structure*): single budget host is intentional; money can physically live
in any real account; **assignment is capped at Ready to Assign**; overspending an
envelope is allowed and covered by inter-envelope transfers; a negative
`…:budget:unallocated` is numerically correct and intentionally not surfaced;
multi-account envelope backing is not a goal. Reference Issue #7.

## Data flow

```
POST /api/budget/assign
  → getReadyToAssign()            [NEW shared util: net worth − envelopes via hledger]
  → if totalAssigned > available  → 400 "only $X left to assign"   (NO write)
  → else appendTransaction(...)   (debit unallocated pool, credit envelopes)

GET /api/budget
  → getReadyToAssign()            [same util — refactor, no behavior change]

pages/budget.vue saveAssignment()
  → delta > readyToAssign ?  toast + abort   (instant)
  → else POST assign ; server 400 also toasts if it slips through
```

## Components & files

| File | Change | Why |
|---|---|---|
| `server/utils/budgetData.ts` | **New.** `getReadyToAssign()` (+ `EPSILON`). | Single source of truth for the pool; reused by gate + report. |
| `server/api/budget.get.ts` | Refactor RTA block to call `getReadyToAssign()`. No behavior change. | De-dupe accounting logic. |
| `server/api/budget/assign.post.ts` | Compute available, reject over-assignment with a clear 400. | The core fix. |
| `server/api/__tests__/budget-assign.test.ts` | **New/extended.** Over-assign rejected; within-budget allowed; savings-backed assignment allowed (State B). | Cover the gate. |
| `pages/budget.vue` | Client-side over-assign guard + message in `saveAssignment`. | Instant feedback; server still authoritative. |
| `.kiro/steering/hledger-budget-app-design.md` | Add the model-decision note. | Issue #7 ask 2. |
| `AI-MAP.md` | Add `server/utils/budgetData.ts` row. | Map upkeep. |

## Edge cases

- **Savings-backed assignment (State B):** host account holds $0 but net worth
  covers it → `getReadyToAssign()` ≥ requested → **allowed**. Negative
  `unallocated` results and is intentionally invisible.
- **Exact-budget assignment:** `totalAssigned == available` → allowed (EPSILON
  guard prevents a rounding rejection).
- **Reducing / reshuffling:** handled by `transfer.post.ts`, never gated — you can
  always walk an assignment back or cover an overspent envelope.
- **Overspending:** unaffected — spending still allowed, envelope Available goes
  red (existing `availableColor`), RTA unchanged.
- **Concurrency:** single-user local app; read-then-append race is acceptable and
  the journal writer's own balance validation remains the final guard.

## Alternatives considered

- **Soft-warn only (original draft / earlier proposal).** Rejected by the product
  owner: the app should not let you assign money that doesn't exist.
- **Gate on the host account's cash instead of RTA.** Rejected — would block the
  legitimate savings-backed assignment that Issue #7 is specifically about.
- **Also block transfers that overdraw the source envelope.** Rejected —
  overspending and covering it by moving funds is the intended mechanism;
  restricting transfers would remove the only way to fix an overspent envelope.
- **Duplicate the RTA formula inside `assign.post.ts`.** Rejected — two copies of
  accounting logic drift; extract a shared util instead.
- **Build multi-account envelope hosting.** Rejected — large model change, not a
  goal; net-worth RTA already delivers the YNAB outcome.
```
