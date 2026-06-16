# Design — Audit the test suite

> Traceability: implements **GitHub Issue #11** ("chore: audit the test suite —
> skipped/gated tests, legacy paths, coverage gaps"). Relates to #4.

## Problem

Some tests are silently *not* protecting us: they're skipped, environment-gated
into no-ops, aimed at a legacy code path, or assert hledger's engine behavior
rather than our code. A green run hides this. This ticket inventories every such
test, decides keep/fix/delete for each with rationale, makes the kept ones
actually run in CI, and flags the highest-value coverage gaps.

## Findings (grounded in the current tree)

I swept `{utils,server,components,composables}/**/*.test.ts` for
`describe.skip` / `it.skip` / `.skipIf` / `it.todo` / `if (!hledgerAvailable) return`.
**All skip/gate machinery lives in one file:**
`server/utils/__tests__/hledger.test.ts`. (A grep hit in
`utils/filterAccounts.property.test.ts` was a false positive — a bare `return`
inside a helper, no skip.)

| # | Location | Pattern | Targets | Verdict |
|---|----------|---------|---------|---------|
| F1 | `hledger.test.ts:327` | `describe.skip('addTransaction rejects invalid input')` | legacy `addTransaction` | **DELETE** |
| F2 | `hledger.test.ts:238` | `describe.skipIf(!hledgerAvailable)('addTransaction round-trip')` | legacy `addTransaction` | **DELETE** |
| F3 | `hledger.test.ts:134` | `if (!hledgerAvailable) return` (timeout-kill test, R1.2) | live `hledgerExec` | **KEEP, make CI run it** |
| F4 | `hledger.test.ts:426` | `it('Property 4: addTransaction only spawns hledger processes…')` — extracts the `addTransaction` source body, asserts it exists + delegates to `runHledger` | legacy `addTransaction` | **DELETE** (found at implementation, not in the original skip/gate sweep) |

> **F4 (found during T2 implementation, not the original sweep).** The sweep
> keyed on skip/gate machinery, so it missed this *non-skipped* test, which is
> coupled to `addTransaction` existing in source via
> `sourceCode.indexOf('export async function addTransaction')` →
> `expect(fnStart).toBeGreaterThan(-1)`. Deleting `addTransaction` (F1/F2 verdict)
> makes that assertion fail. It lives inside the `describe('hledger is the sole
> journal writer')` block alongside **two module-invariant tests that must stay**
> (hledger.ts contains no `fs` writes / does not import `fs` — still true and
> still valuable). Verdict: delete only the `addTransaction`-specific `it`; keep
> the block and its other two tests.

### Why each verdict

**F1 — asserts engine behavior we don't own.** The test wants `addTransaction`
to *reject* unbalanced postings. `hledger add` (stdin) doesn't — it silently
zeroes them and exits 0 (the skip comment says as much). So the assertion is
about hledger, not our code. The behavior it *wishes* existed **does** exist on
the production write path: `appendTransaction` →
`validateTransaction` rejects a non-zero cents sum, already covered by
`journalWriter.test.ts:72` ("does not sum to zero") and `:97` ("one-cent
imbalance"). The skipped test is redundant **and** wrong-target → delete.

**F2 — exercises a legacy path.** Production writes go through the **direct
journal writer** (`appendTransaction`), per `tech.md` and
`separation-of-concerns.md` ("New transactions go through the direct journal
writer … NOT `hledger add`"). `addTransaction` is the old `hledger add` path.
Its round-trip is superseded by the writer's own coverage
(`journalWriter.property.test.ts` append/round-trip, `journalWriter.test.ts`
`appendTransaction()` block). → delete with the function (see below).

**F3 — genuinely needs a real process.** It sets `HLEDGER_TIMEOUT_MS=1` and
asserts `hledgerExec` kills and rejects with `/timed out/`. That requires a
real binary that takes >1ms; it can't be faked deterministically cross-platform
(the spawn is `spawn(bin, ['print'])` — substituting `node`/a sleeper doesn't
fit the arg shape). The fix is not to the test but to the environment: **CI
must install hledger** so the guard doesn't no-op. Keep the guard as a
graceful-skip for local dev machines without hledger.

### The legacy-path wart behind F1/F2: `addTransaction` is still wired in

The issue asks whether `addTransaction` should be retired entirely. It's
**not unused** — `server/api/categories.post.ts` calls it to create/close
category accounts (zero-amount balanced entries). That's the only production
caller, and it's a **separation-of-concerns violation**: it uses `hledger add`
instead of the direct writer, and because `addTransaction` skips
`validateTransaction`, the route has to bolt on a manual `fieldHasIllegalChars`
guard (`categories.post.ts:13`) to compensate.

So "retire `addTransaction`" is really: **migrate `categories.post.ts` to
`appendTransaction`, then delete `addTransaction`.** The migration is a net
simplification — `appendTransaction` runs `validateTransaction`, so the manual
control-char guard becomes redundant (kept-or-removed per requirements).

### The bigger CI gap

`.github/workflows/ci.yml` (just landed on `main`) has **only a `typecheck`
job — no test job at all.** So today the *entire* suite never runs in CI, not
just the gated tests. Installing hledger is necessary but insufficient; CI needs
a **test job** that runs `npm run test` with hledger on PATH.

## Proposed solution

Four coordinated changes:

### 1. Retire the legacy write path (production code)
- `server/api/categories.post.ts`: replace both `addTransaction({...})` calls
  with `appendTransaction({...})`. Re-evaluate the manual `fieldHasIllegalChars`
  guard — `validateTransaction` now covers control chars in description/account,
  but keep an explicit 400 if we want a friendlier message than the joined
  validator error (decided in requirements).
- `server/utils/hledger.ts`: delete `export async function addTransaction`.

### 2. Clean the tests
- Delete F1 (`describe.skip` block) and F2 (`describe.skipIf` block) from
  `hledger.test.ts`, plus the now-unused `addTransaction` import.
- The `checkHledgerAvailable()` helper + `hledgerAvailable` const stay — F3
  still uses them.
- Repoint stubs that referenced the deleted function:
  `server/api/__tests__/api-routes.test.ts:22` and
  `server/api/__tests__/categories-security.test.ts:13` both
  `vi.stubGlobal('addTransaction', …)`. After migration they must stub
  `appendTransaction` and assert the route still rejects malicious category
  names (the security guarantee must not regress).

### 3. CI runs the suite with hledger
- Add a `test` job to `.github/workflows/ci.yml` (sibling to `typecheck`):
  checkout → setup-node 20 + npm cache → `npm ci` → **install hledger** →
  `npm run test`.
- hledger install on `ubuntu-latest`: prefer the official
  `apt-get install -y hledger` (simple, no Haskell toolchain). Pin/verify with
  `hledger --version` as a step so a silent install failure fails the job
  rather than letting F3 no-op again.

### 4. Coverage-gap pass (audit deliverable)
Classify production paths vs. legacy and document in this spec's outcome.
Current state from the sweep:
- **Direct journal writer** — well covered (`journalWriter.test.ts`,
  `journalWriter.property.test.ts`). ✓
- **Budget base resolution on a non-default host** — covered as a *unit*
  (`resolveBudgetBase`, `hledger.test.ts:159`). **Gap:** no test that
  `budget/assign` routes correctly when the base is *not* `assets:checking`.
  Flag; fill if cheap (decided in requirements — R6).
  - **Correction (requirements gate):** the original wording said "`budget/assign`
    + `budget/transfer` route … by the budget base." Code review showed this is
    inaccurate: neither write route calls `resolveBudgetBase` (it is a *read*-side
    resolver used by `budget.get.ts`). `budget/assign` routes by the request's
    `physicalAccount` (`<physicalAccount>:budget:<category>` +
    `toUnallocatedAccount(physicalAccount)`); `budget/transfer` echoes
    fully-qualified envelope paths verbatim and has **no** base concept. The gap
    is therefore `assign`-only and cheap (route test, stubbed `appendTransaction`,
    no live hledger). `transfer` has nothing base-specific to assert.
- **Register seeding / envelope routing** — flag for inventory; document
  whether covered or a follow-up.

Anything not cheaply fillable here is **documented as a follow-up**, not
silently left — the audit's value is the written classification, not a vow to
close every gap in one PR.

## Files touched

| File | Change |
|------|--------|
| `server/api/categories.post.ts` | `addTransaction` → `appendTransaction` (×2); reassess manual guard |
| `server/utils/hledger.ts` | delete `addTransaction` |
| `server/utils/__tests__/hledger.test.ts` | delete F1 + F2 blocks; drop `addTransaction` import |
| `server/api/__tests__/api-routes.test.ts` | stub `appendTransaction` instead of `addTransaction` |
| `server/api/__tests__/categories-security.test.ts` | stub `appendTransaction`; keep security assertions |
| `.github/workflows/ci.yml` | add `test` job (npm ci + install hledger + `npm run test`) |
| `.kiro/specs/audit-test-suite/` | this spec + the written classification outcome |
| (maybe) new coverage test | non-default-base assign/transfer, if cheap |

## Edge cases
- **Local dev without hledger:** F3 must still skip gracefully (keep the guard);
  only CI is guaranteed to have hledger.
- **Security regression risk:** the category-name injection guard is currently
  enforced *before* `addTransaction`. After migration, `validateTransaction`
  enforces it inside `appendTransaction`. The security tests must continue to
  assert a rejection — this is the load-bearing check, not the implementation
  detail of where the guard lives.
- **hledger apt version drift:** Ubuntu's packaged hledger may lag. The suite
  doesn't depend on bleeding-edge behavior (F3 just needs *a* hledger that can
  be made to time out), so the distro package is acceptable; the `--version`
  step documents what ran.

## Alternatives considered

1. **Keep `addTransaction`; just un-skip/fix its tests.** Rejected as the
   primary path: it leaves a legacy `hledger add` write in production that
   violates the direct-writer rule and forces the manual guard in
   `categories.post.ts`. Retiring it is the steering-aligned fix. *(Offered as
   the fallback at the design gate if you'd rather keep this ticket
   test-only and split the production change into its own ticket.)*
2. **Make F3 deterministic instead of hledger-gated** (fake a slow binary).
   Rejected: no clean cross-platform sleeper fits `spawn(bin, ['print'])`, and
   it would test our fake, not the real spawn/kill path. CI-installs-hledger is
   simpler and tests the real thing.
3. **Delete the `if (!hledgerAvailable) return` guard outright** so F3 always
   runs. Rejected: it would fail on dev machines without hledger. Graceful skip
   locally + guaranteed run in CI is the right split.
4. **Add only an hledger install step to the existing typecheck job.** Rejected:
   the typecheck job doesn't run tests at all; a dedicated `test` job is needed
   regardless.
