# Design — Fix pre-existing typecheck errors

> Traceability: implements **GitHub Issue #10** ("chore: fix pre-existing
> typecheck errors"). Relates to #4.

## Problem

`npx nuxi typecheck` is **not clean** on `main`. Re-baselined on
`chore/fix-typecheck-errors` (branched from `main` at `e590105`, i.e. *after*
PR #12 merged) it reports **78 errors** — identical count and breakdown to the
issue, because the test files PR #12 added already follow the `!`-on-index
convention and contribute zero.

Current breakdown (re-measured, not copied from the issue):

| Count | Code(s) | File |
|------:|---------|------|
| 38 | TS2532 / TS18048 | `utils/toRegisterRows.test.ts` |
| 13 | TS2532 | `utils/toTransactionInput.test.ts` |
| 12 | TS2532 | `utils/toTransactionInput.property.test.ts` |
| 7  | TS18048 | `utils/roundTrip.property.test.ts` |
| 6  | TS18048 | `utils/toRegisterRows.property.test.ts` |
| 1  | TS2532 | `server/api/__tests__/migration.test.ts` |
| 1  | **TS2322** | `pages/accounts/[...path].vue` |

By error code: **40× TS2532**, **37× TS18048** (both `noUncheckedIndexedAccess`),
**1× TS2322** (a real type mismatch).

CI does not currently gate on typecheck, so these have accumulated silently.

## Two distinct problems

This is **not** one homogeneous fix. There are two root causes:

### A. 77 test-file errors — `noUncheckedIndexedAccess` ergonomics (benign)

With `noUncheckedIndexedAccess`, any array index or destructure yields
`T | undefined`. The tests index results they *know* are populated (they
construct the input) but never tell the compiler. Three shapes appear:

1. **Array index** — `rows[0].runningBalance` → `rows[0]` is `Row | undefined`.
2. **Destructure** — `const [row] = toRegisterRows(...)` → `row` is
   `Row | undefined`.
3. **Mock-call tuple** — `mockAppendTransaction.mock.calls[0][0]` → both
   `[0]` indexes are possibly-undefined (`migration.test.ts:113`).

These are genuinely safe accesses in test context, so the fix is to assert
non-null at the indexing site. This is **the same pattern the codebase already
adopted** for newly written tests (per the issue), so we are converging on an
existing convention, not inventing one.

### B. 1 page-component error — a **real latent runtime bug** (TS2322)

`pages/accounts/[...path].vue:106` — `@delete="deleteTx"`:

```
Type '(row: { transactionIndex: number; }) => Promise<void>'
  is not assignable to type '(index: number) => any'.
```

`AccountRegister` declares `defineEmits<{ edit: [index: number]; delete:
[index: number] }>()` and emits **a plain number**
(`emit('delete', row.original.transactionIndex)`). But the page handler is
typed/written to receive an **object**:

```ts
async function deleteTx(row: { transactionIndex: number }) {
  deleting.value = row.transactionIndex          // number.transactionIndex → undefined
  await $fetch('/api/transactions', {
    method: 'DELETE',
    query: { index: row.transactionIndex },      // index: undefined  ← bug
  })
}
```

At runtime the handler receives a number, so `row.transactionIndex` is
`undefined` and the delete request sends `index: undefined`. **The typecheck
error is surfacing a genuine defect**, exactly as the issue anticipated
("may be a real type gap, not just test ergonomics"). This one is fixed by
correcting the handler, not by silencing the index.

## Proposed solution

### A. Test files — non-null assertion at the indexing site

Prefer `!` exactly where the issue recommends ("`!` on indexed access where the
index is provably in range"):

```ts
// array index
expect(rows[0]!.runningBalance).toBe(-5)

// destructure
const [row] = toRegisterRows(txs, 'assets:checking')
expect(row!.inflow).toBeNull()

// mock-call tuple
const txInput = mockAppendTransaction.mock.calls[0]![0]
```

Rationale for `!` over the alternatives:

- **`!` (chosen)** — minimal diff, matches the convention already in newer
  tests, keeps each assertion on one line, reads as "this is provably present."
- **Guard (`if (!row) throw`)** — heavier; only worth it where a destructure is
  reused across many lines. We will use a single hoisted `const row = rows[i]!`
  where a row is dereferenced repeatedly in one test, to avoid `!`-noise on
  every line (judgment call per block, favoring readability).
- **Rewriting helpers to return non-optional types** — out of scope and wrong:
  the helpers are correctly typed; the gap is purely at test call sites.

No production `utils/` source changes — only the `.test.ts` / `.property.test.ts`
call sites.

### B. Page component — fix the handler signature and body

Align `deleteTx` with the emitted `number`, fixing the latent bug:

```ts
async function deleteTx(transactionIndex: number) {
  if (!confirm('Delete this transaction? This cannot be undone.')) return
  deleting.value = transactionIndex
  try {
    await $fetch('/api/transactions', {
      method: 'DELETE',
      query: { index: transactionIndex },
    })
    ...
```

While here, tighten `editTx(_row: any)` → `editTx(_index: number)` to match the
`edit: [index: number]` emit and remove the `any` (coding-standards: no `any`).
This is in-scope cleanup of the same emit contract, not scope creep.

This change is behavior-affecting (it repairs delete). **Regression guard
(decided 2026-06-14): the typecheck gate itself.** The suite has no
component-mount harness and `deleteTx` is not exported, so a runtime test would
require new devDeps (`@nuxt/test-utils` + happy-dom) and brittle Nuxt UI
stubbing — disproportionate for a one-line client fix. Instead, the now
CI-gated `nuxi typecheck` (R4) structurally forbids the regression: reverting
`deleteTx` to a non-`number` param reintroduces the exact `TS2322` and fails CI.
See R3.4.

### CI gate (final step)

Once typecheck is clean, the issue asks to "make `npx nuxi typecheck` a required
gate (CI) so this can't regress." There is currently **no CI workflow in the
repo at all** (tests aren't gated either).

**Decision (confirmed): add a typecheck-only CI workflow here.** Create
`.github/workflows/ci.yml` that, on push/PR to `main`, runs `npm ci` then
`npx nuxi typecheck`. Deliberately **no test job** in this ticket: the test
suite has hledger-on-PATH-gated tests whose CI wiring overlaps with #11, so a
test job is left to a follow-up. A typecheck-only job is self-contained (no
hledger needed) and directly fulfills the issue's "can't regress" requirement.

Notes for the workflow:
- This will be the repo's first GitHub Actions file — keep it minimal and
  conventional (checkout → setup-node with npm cache → `npm ci` → typecheck).
- `nuxi typecheck` needs the Nuxt types prepared; it runs `nuxi prepare`
  implicitly, but the workflow should not assume a committed `.nuxt/`.
- Pin `actions/checkout` and `actions/setup-node` to major version tags.

## Files touched

| File | Change | Errors fixed |
|------|--------|-------------:|
| `utils/toRegisterRows.test.ts` | `!` on indexed/destructured rows | 38 |
| `utils/toTransactionInput.test.ts` | `!` on indexed access | 13 |
| `utils/toTransactionInput.property.test.ts` | `!` on indexed access | 12 |
| `utils/roundTrip.property.test.ts` | `!` on destructured rows | 7 |
| `utils/toRegisterRows.property.test.ts` | `!` on indexed/destructured rows | 6 |
| `server/api/__tests__/migration.test.ts` | `!` on mock-call tuple | 1 |
| `pages/accounts/[...path].vue` | fix `deleteTx`/`editTx` signatures (bug fix) | 1 |
| `.github/workflows/ci.yml` *(new)* | typecheck-only CI gate (npm ci → nuxi typecheck) | — |

No config files touched (`tsconfig*`, `nuxt.config`, `vitest.config` are
off-limits per coding-standards — the goal is a genuinely clean typecheck, not a
silenced one).

## Edge cases / risks

- **Behavior-preserving for tests:** `!` is a compile-time assertion only — zero
  runtime change; the test suite must still pass identically afterward.
- **The page fix changes runtime behavior** (delete now sends a real index).
  Must be verified by a test and ideally a manual delete in the running app.
- **Regression visibility:** without a CI gate, a clean typecheck can silently
  re-break. Mitigated by the (deferred) CI recommendation; at minimum the final
  task re-asserts a clean run.
- **`any` in tests** is permitted by coding-standards (mocking), so existing
  `e: any` / mock `any` usage in these files is left as-is unless it causes an
  error.

## Alternatives considered

- **Relax `noUncheckedIndexedAccess` or exclude tests from typecheck** —
  rejected outright; coding-standards forbid fixing via tooling config, and the
  issue explicitly calls this out.
- **Wrap every test access in `if (!x) throw`** — rejected as default; too noisy
  for the 77 provably-safe sites. Used sparingly only where a value is reused.
- **Silence the page error with `as any` on the handler** — rejected; it would
  hide the real delete bug instead of fixing it.
