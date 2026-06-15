# Tasks — Fix pre-existing typecheck errors

> Traceability: **GitHub Issue #10**. Implements [design.md](./design.md),
> satisfies [requirements.md](./requirements.md).
> Verify each task with the single-file typecheck where possible:
> `npx vue-tsc --noEmit -p . 2>&1 | grep <file>` is unreliable under Nuxt, so
> use `npx nuxi typecheck 2>&1 | grep <file>` to confirm a file is clean, and a
> full `npx nuxi typecheck` only at the end.

## Test call-site fixes (Group R2)

- [x] **T1 — `utils/toRegisterRows.test.ts`** (38 errors). Add `!` at each
  flagged index/destructure site (lines ~50–384); hoist `const row = rows[i]!`
  where a row is reused across several asserts. _Verify:_ `npx nuxi typecheck
  2>&1 | grep toRegisterRows.test` → no output; `npx vitest run
  utils/toRegisterRows.test.ts` passes. _Covers:_ R2.1–R2.4.

- [x] **T2 — `utils/toTransactionInput.test.ts`** (13 errors, lines ~21–130).
  `!` on indexed access. _Verify:_ typecheck grep clean + `npx vitest run
  utils/toTransactionInput.test.ts`. _Covers:_ R2.1, R2.4.

- [x] **T3 — `utils/toTransactionInput.property.test.ts`** (12 errors, lines
  ~93–159). `!` on indexed access inside fast-check properties. _Verify:_
  typecheck grep clean + `npx vitest run utils/toTransactionInput.property.test.ts`
  (allow extra time — property tests are slow). _Covers:_ R2.1, R2.4.

- [x] **T4 — `utils/roundTrip.property.test.ts`** (7 errors, lines ~108–122).
  `!` on destructured `row`. _Verify:_ typecheck grep clean + `npx vitest run
  utils/roundTrip.property.test.ts`. _Covers:_ R2.1, R2.4.

- [x] **T5 — `utils/toRegisterRows.property.test.ts`** (6 errors, lines
  ~177–190). `!` on indexed/destructured row. _Verify:_ typecheck grep clean +
  `npx vitest run utils/toRegisterRows.property.test.ts`. _Covers:_ R2.1, R2.4.

- [x] **T6 — `server/api/__tests__/migration.test.ts`** (1 error, line 113).
  `mockAppendTransaction.mock.calls[0]![0]`. _Verify:_ typecheck grep clean +
  `npx vitest run server/api/__tests__/migration.test.ts`. _Covers:_ R2.1, R2.4.

## Page component bug fix (Group R3)

- [ ] **T7 — Fix `deleteTx`/`editTx` in `pages/accounts/[...path].vue`.**
  Change `deleteTx(row: { transactionIndex: number })` →
  `deleteTx(transactionIndex: number)`, updating both `deleting.value` and the
  `query.index` to use `transactionIndex` directly. Change `editTx(_row: any)` →
  `editTx(_index: number)`. _Verify:_ `npx nuxi typecheck 2>&1 | grep
  '\[...path\]'` → no output (clears the lone TS2322). _Covers:_ R3.1–R3.3.

- [x] **T8 — Regression guard for the delete path.** _Decision (2026-06-14):_
  no runtime test added — the suite has no component-mount harness and
  `deleteTx` is not exported, so a test would require new devDeps + brittle Nuxt
  UI stubbing. The fix is instead guarded by the **CI typecheck gate** (T9):
  reverting `deleteTx` to a non-`number` param reintroduces the same `TS2322`
  and fails CI. design.md + R3.4 updated to reflect this. _Covers:_ R3.4, NFR1.

## CI gate (Group R4)

- [x] **T9 — Add `.github/workflows/ci.yml`.** On `push` and `pull_request` to
  `main`: checkout (`actions/checkout@v4`), `actions/setup-node@v4` (Node 20,
  `cache: npm`), `npm ci`, then `npx nuxi typecheck`. No test job. _Verify:_
  `npx js-yaml .github/workflows/ci.yml` (or equivalent) parses; review the run
  on the eventual PR. _Covers:_ R4.1–R4.4.

## Final checkpoint

- [x] **T10 — Full verification.**
  1. `npx nuxi typecheck` → exits 0, **zero** `error TS` lines (R1.1).
  2. `npm test` → full suite green (NFR1).
  3. `git diff --stat` confined to the design's "Files touched" table (NFR3);
     confirm no config files changed (R1.2) and no new `any` (NFR2).
  Then update `AI-MAP.md` if any quirk note is warranted (e.g. the delete-index
  bug fix), and report results.
