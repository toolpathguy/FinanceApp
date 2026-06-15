# Requirements — Fix pre-existing typecheck errors

> Traceability: **GitHub Issue #10**. Builds on the approved
> [design.md](./design.md).

## User stories & acceptance criteria

### R1 — Clean typecheck
**As a** contributor, **I want** `npx nuxi typecheck` to pass with zero errors,
**so that** type regressions are visible and the check can gate CI.

- **R1.1** — WHEN a developer runs `npx nuxi typecheck` on this branch, THE
  SYSTEM SHALL exit `0` with **no `error TS` lines** (currently 78).
- **R1.2** — THE fix SHALL NOT modify any tooling/compiler config
  (`tsconfig*.json`, `nuxt.config.ts`, `vitest.config.*`, etc.); in particular
  `noUncheckedIndexedAccess` SHALL remain enabled and no test files SHALL be
  excluded from typecheck.

### R2 — Test call-site fixes (the 77 `noUncheckedIndexedAccess` errors)
**As a** contributor, **I want** the test indexing errors resolved without
weakening the tests, **so that** the suite keeps asserting the same behavior.

- **R2.1** — WHEN an array index or destructured element that is provably
  in range is dereferenced in a test, THE SYSTEM SHALL use a non-null assertion
  (`!`) at the indexing site (e.g. `rows[0]!.x`, `const [row] = …; row!.x`,
  `mock.calls[0]![0]`).
- **R2.2** — WHERE a single value is dereferenced repeatedly within one test
  block, THE fix MAY hoist it to one `const x = arr[i]!` rather than repeating
  `!` on every line, when that reads more clearly.
- **R2.3** — THE fix SHALL NOT change any production `utils/` source; only the
  `.test.ts` / `.property.test.ts` call sites and `migration.test.ts`.
- **R2.4** — Each affected test SHALL retain its original assertions (no test
  deleted, skipped, or weakened to dodge the error).

### R3 — Page component delete bug (the 1 `TS2322` error)
**As a** user, **I want** deleting a transaction from the account register to
send the correct index, **so that** the right transaction is deleted.

- **R3.1** — THE `deleteTx` handler in `pages/accounts/[...path].vue` SHALL
  accept a `number` (matching `AccountRegister`'s `delete: [index: number]`
  emit) and use it directly as the delete index.
- **R3.2** — WHEN a user confirms deletion of a transaction, THE SYSTEM SHALL
  issue `DELETE /api/transactions` with `query.index` set to the emitted
  numeric transaction index (never `undefined`).
- **R3.3** — THE `editTx` handler SHALL be typed `(_index: number)` to match the
  `edit` emit, removing the `any` parameter.
- **R3.4** — The handler/emit contract SHALL be protected from regression by the
  **typecheck gate** (R4): if `deleteTx` ever reverts to a non-`number` param it
  reintroduces the same `TS2322`, failing CI. _Decision (2026-06-14):_ a runtime
  test is NOT added — the suite has no component-mount harness, `deleteTx` is not
  exported, and adding one (`@nuxt/test-utils` + happy-dom + Nuxt UI stubbing)
  is disproportionate for a client-only fix the type gate already guards. See
  design "CI gate" / Edge cases.

### R4 — CI gate
**As a** maintainer, **I want** typecheck enforced in CI, **so that** a clean
typecheck cannot silently regress.

- **R4.1** — THE repo SHALL contain `.github/workflows/ci.yml` that, on push and
  pull_request targeting `main`, runs `npm ci` then `npx nuxi typecheck`.
- **R4.2** — THE workflow SHALL fail the job when typecheck reports any error
  (i.e. rely on the non-zero exit code; no error-swallowing).
- **R4.3** — THE workflow SHALL pin `actions/checkout` and `actions/setup-node`
  to major-version tags and use npm dependency caching.
- **R4.4** — THE workflow SHALL NOT include a unit-test job (deferred to a
  follow-up that handles hledger-on-PATH; see #11).

## Non-functional requirements

- **NFR1 — Behavior preservation:** `npm test` SHALL pass after the change with
  the same set of tests as before (the page fix may add one test; no test is
  removed).
- **NFR2 — No `any` introduced:** the change SHALL NOT add `any`/`as any`; it
  SHALL remove the one `any` in `editTx` (R3.3). Pre-existing permitted test
  `any` (mocking, `catch (e: any)`) MAY remain.
- **NFR3 — Minimal diff:** fixes SHALL be confined to the files listed in the
  design's "Files touched" table.

## Out of scope

- Adding a **unit-test job** to CI (needs hledger on PATH — see #11).
- The broader test-suite audit (skipped/gated tests, legacy paths) — that is
  **#11**.
- Any refactor of `toRegisterRows` / `toTransactionInput` production types or
  the `AccountRegister` component beyond the emit-contract alignment.
- Implementing transaction **edit** (still a "not yet supported" toast).
