# Requirements — Enforce budget availability (no assigning money you don't have)

> Traceability: **GitHub Issue #7**. Derived from the approved
> [design.md](./design.md). EARS-style acceptance criteria.

## User stories

### US-1 — Can't budget money I don't have
**As a** budgeter, **I want** the app to stop me from assigning more to envelopes
than actually exists (Ready to Assign), **so that** my budget never promises money
I don't have — like a physical envelope you can't put cash in that you don't hold.

### US-2 — Money in any account counts
**As a** budgeter who keeps cash in savings while budgeting it into envelopes,
**I want** "money that exists" to mean my **total net worth** (all real
accounts), **so that** I can assign savings-backed money even when checking is
empty.

### US-3 — Overspending is allowed and recoverable
**As a** budgeter, **I want** to be able to overspend an envelope and cover it by
moving funds from another envelope, **so that** real-life overspending is handled
by reshuffling, not blocked.

### US-4 — Know the intended model
**As a** future contributor, **I want** the design doc to record the single-host /
money-can-be-anywhere model and the assignment cap, **so that** I don't mistake
them (or an invisible negative `unallocated`) for bugs.

## Acceptance criteria (EARS)

### Assignment availability gate
- **AC-1** — WHEN an assignment's total would exceed current Ready to Assign
  (net worth − envelopes) beyond a half-cent epsilon, THE SYSTEM SHALL reject the
  assignment with HTTP 400 and SHALL NOT write any transaction to the journal.
- **AC-2** — THE rejection message SHALL state both the requested amount and the
  amount actually available (e.g. "Can't assign $500.00 — only $380.00 left to
  assign.").
- **AC-3** — WHEN an assignment's total is within Ready to Assign (including the
  exact-budget boundary, within epsilon), THE SYSTEM SHALL accept it and write the
  assignment as today.
- **AC-4** — THE availability check SHALL be enforced **server-side** in the
  assign endpoint (independent of any client-side guard), using the shared
  `getReadyToAssign()` util.

### Net-worth basis (savings counts)
- **AC-5** — WHEN the budget-host account (checking) holds less than the requested
  assignment but total net worth (assets + liabilities, incl. savings) covers it,
  THE SYSTEM SHALL accept the assignment.
- **AC-6** — THE SYSTEM SHALL NOT gate assignment on a single account's balance;
  the gate SHALL be the net-worth-based Ready-to-Assign pool only.

### Over-assignment scenario test (explicit, per request)
- **AC-7** — THERE SHALL be a test asserting that when the **sum of envelope
  assignments would exceed total net worth**, the assignment is **rejected** (400,
  no journal write) — i.e. total assigned can never exceed net worth.
- **AC-8** — THERE SHALL be a complementary test asserting that an assignment of
  savings-backed money (checking empty, net worth sufficient) is **accepted**
  (State B), proving the gate is net-worth-based, not host-account-based.

### Overspending & transfers unaffected
- **AC-9** — THE SYSTEM SHALL continue to allow an envelope's Available to go
  negative through spending (overspending is not blocked).
- **AC-10** — THE SYSTEM SHALL NOT gate budget transfers (envelope↔envelope,
  incl. reduce-to-unallocated); they remain available to cover overspending and to
  walk back assignments.

### Client feedback
- **AC-11** — WHEN the user raises an inline assignment beyond Ready to Assign,
  THE budget page SHALL show a clear message and SHALL NOT silently appear to
  succeed; a server rejection that reaches the client SHALL surface its message.

### Shared computation (no duplication)
- **AC-12** — THE Ready-to-Assign computation SHALL live in one shared server util
  (`getReadyToAssign()`), consumed by both `budget.get.ts` and the assign gate;
  the `GET /api/budget` figures SHALL be unchanged by the refactor.

### Documentation
- **AC-13** — THE design doc SHALL record: single budget host is intentional;
  money can physically live in any real account; assignment is capped at Ready to
  Assign; overspending is allowed and covered by transfers; a negative
  `…:budget:unallocated` is correct and intentionally not surfaced; multi-account
  envelope backing is not a goal. Reference Issue #7.

## Non-functional requirements
- **NFR-1 — Layer boundaries:** accounting/RTA logic in `server/utils`; the assign
  endpoint orchestrates (gate → write); no RTA math duplicated in the `.vue` or in
  two endpoints (`separation-of-concerns.md`).
- **NFR-2 — Delegate to hledger:** `getReadyToAssign()` derives the figure from
  hledger balance reads, not a hand-rolled ledger walk.
- **NFR-3 — Verification:** `npm run test` (incl. new gate tests) and
  `npx nuxi typecheck` pass.
- **NFR-4 — Tests beside source / conventions:** API tests under
  `server/api/__tests__/`, Nitro globals stubbed with `vi.stubGlobal()`.

## Out of scope
- Multi-account envelope hosting / multiple budget bases (not a goal).
- Changing the RTA formula or the accounting engine.
- Surfacing per-host `unallocated` balances in the UI.
- New "move funds to cover overspending" UI beyond the existing transfer endpoint
  (the mechanism exists; dedicated UI is a separate effort).
- Restricting transfers / blocking overspending.
