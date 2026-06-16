# Requirements — Audit the test suite

> Traceability: implements **GitHub Issue #11**. Relates to #4. Derived from the
> approved `design.md` in this folder. EARS form: "WHEN … THE SYSTEM SHALL …".

## Gate decisions (resolved at this requirements gate)

- **Manual `fieldHasIllegalChars` guard in `categories.post.ts`: KEEP.** After
  migrating to `appendTransaction`, retain the explicit pre-check so the route
  returns a friendly, category-specific 400 rather than the generic joined
  validator string. The guard is defense-in-depth, not the sole protection.
- **Non-default-base assign/transfer coverage gap: FILL NOW (if cheap).** Add a
  route-level test that `budget/assign` + `budget/transfer` behave correctly when
  the budget base is not `assets:checking`. If it proves not cheap (needs a live
  hledger fixture or large scaffolding), downgrade to a documented follow-up and
  say so explicitly in the spec outcome.

---

## R1 — Retire the legacy `addTransaction` write path

**User story:** As a maintainer, I want category create/close to use the same
direct journal writer as every other write, so the codebase has one write path
and no legacy `hledger add` code to reason about.

- **R1.1** WHEN `categories.post.ts` handles a `create` action THE SYSTEM SHALL
  persist the zero-amount balanced entry via `appendTransaction`, not
  `addTransaction`.
- **R1.2** WHEN `categories.post.ts` handles a `delete` action THE SYSTEM SHALL
  persist the close entry via `appendTransaction`, not `addTransaction`.
- **R1.3** WHEN the migration is complete THE SYSTEM SHALL contain no exported
  `addTransaction` function in `server/utils/hledger.ts` and no remaining import
  or call of it anywhere in the tree.
- **R1.4** THE SYSTEM SHALL retain the existing `categories.post.ts` behavior
  contract: a successful create/delete returns `201` with `{ success: true,
  account }`, and `account` is `expenses:<lowercased-trimmed-name>`.

## R2 — Preserve the category-name injection guard (no security regression)

**User story:** As a maintainer, I must not let the journal-injection protection
regress when the implementation moves.

- **R2.1** WHEN a category `name` contains a control character (`\r`, `\n`, or
  `\t`) THE SYSTEM SHALL reject the request with HTTP `400` and SHALL NOT append
  anything to the journal.
- **R2.2** THE SYSTEM SHALL keep an explicit `fieldHasIllegalChars` pre-check in
  `categories.post.ts` that returns a category-specific 400 message (friendly
  message decision above), in addition to the `validateTransaction` enforcement
  inside `appendTransaction`.
- **R2.3** WHEN required fields are missing (`action` or non-blank `name`) or the
  action is not `create`/`delete` THE SYSTEM SHALL return `400` as it does today.

## R3 — Clean the gated/legacy tests

**User story:** As a maintainer, I want the test suite to contain only tests that
protect real, owned behavior, so a green run is trustworthy.

- **R3.1** THE SYSTEM SHALL remove finding **F1** — the
  `describe.skip('addTransaction rejects invalid input')` block in
  `hledger.test.ts` — because it asserts hledger engine behavior we don't own and
  is redundant with `journalWriter.test.ts` balance coverage.
- **R3.2** THE SYSTEM SHALL remove finding **F2** — the
  `describe.skipIf(!hledgerAvailable)('addTransaction round-trip')` block — as a
  legacy-path test superseded by the direct-writer coverage.
- **R3.3** THE SYSTEM SHALL drop the now-unused `addTransaction` import from
  `hledger.test.ts` while retaining `checkHledgerAvailable()` and the
  `hledgerAvailable` const (still used by F3).
- **R3.4** WHEN F1 and F2 are removed THE SYSTEM SHALL leave finding **F3** (the
  `HLEDGER_TIMEOUT_MS=1` timeout-kill test) intact, including its
  `if (!hledgerAvailable) return` graceful-skip guard.
- **R3.6** WHEN `addTransaction` is deleted THE SYSTEM SHALL remove finding
  **F4** — the `it('Property 4: addTransaction only spawns hledger processes…')`
  test (`hledger.test.ts:426`) that asserts the function exists in source — while
  retaining the other two tests in the `describe('hledger is the sole journal
  writer')` block (the module-invariant checks that hledger.ts performs no direct
  `fs` writes and does not import `fs`).
- **R3.5** WHEN the test files that stubbed `addTransaction`
  (`api-routes.test.ts`, `categories-security.test.ts`) are updated THE SYSTEM
  SHALL stub `appendTransaction` instead, and `categories-security.test.ts` SHALL
  continue to assert that malicious category names are rejected (R2.1 must still
  be proven by a test).

## R4 — CI runs the full suite with hledger available

**User story:** As a maintainer, I want CI to actually run the tests — including
the hledger-gated one — so gated tests stop silently no-op'ing.

- **R4.1** THE SYSTEM SHALL add a `test` job to `.github/workflows/ci.yml`,
  sibling to the existing `typecheck` job, triggered on the same `push`/
  `pull_request` to `main`.
- **R4.2** THE `test` job SHALL: checkout → setup-node 20 with npm cache →
  `npm ci` → install hledger → run `npm run test`. THE hledger install SHALL run
  on every job invocation (GitHub-hosted runners are ephemeral — no state
  persists between runs) and SHALL NOT be cached: a stale/partial apt cache could
  reintroduce the silent no-op failure mode this ticket exists to remove.
- **R4.3** WHEN hledger fails to install THE SYSTEM SHALL fail the job at a
  `hledger --version` verification step, rather than letting F3 silently skip.
- **R4.4** WHEN the `test` job runs in CI THE SYSTEM SHALL execute F3 for real
  (hledger present → guard does not no-op).
- **R4.5** THE SYSTEM SHALL NOT modify the `typecheck` job's behavior.

## R5 — Coverage-gap classification (audit deliverable)

**User story:** As a maintainer, I want the audit's findings written down, so the
classification (not just the code changes) is the durable deliverable.

- **R5.1** THE SYSTEM SHALL record, in a spec outcome document
  (`.kiro/specs/audit-test-suite/outcome.md`), the keep/fix/delete verdict and
  rationale for every gated/legacy test found (F1–F3).
- **R5.2** THE SYSTEM SHALL classify the production write/read paths as
  well-covered, thinly-covered, or uncovered, listing the test file(s) that
  cover each.
- **R5.3** WHEN a flagged gap is not closed in this PR THE SYSTEM SHALL document
  it as an explicit follow-up (with enough detail to file a ticket), not leave it
  silent.

## R6 — Fill the non-default budget-base coverage gap for `budget/assign`

**User story:** As a maintainer, I want assurance that an envelope assignment
routes its postings under the account the request names, even when that account
is not the default `assets:checking`.

> Scoping note: code review at the requirements gate showed the write routes do
> **not** call `resolveBudgetBase` (that is a read-side resolver used by
> `budget.get.ts`). `budget/assign` routes by the request's `physicalAccount`;
> `budget/transfer` echoes fully-qualified envelope paths verbatim and has no
> base concept. So this requirement covers `assign` only — `transfer` has no
> base-routing behavior to assert. See the design's "Correction" note.

- **R6.1** WHEN `budget/assign` receives a non-default `physicalAccount` (e.g.
  `assets:savings`) THE SYSTEM SHALL write each envelope posting under
  `<physicalAccount>:budget:<category>` and the offsetting posting to
  `toUnallocatedAccount(<physicalAccount>)`, and a route-level test SHALL assert
  this by inspecting the captured transaction (stubbed `appendTransaction`, no
  live hledger).
- **R6.2** IF satisfying R6.1 unexpectedly requires a live hledger fixture or
  disproportionate scaffolding THE SYSTEM SHALL instead document the gap as a
  follow-up per R5.3, and the spec outcome SHALL state why it was deferred.

---

## Non-functional requirements

- **NFR1 — No config loosening.** No change to `vitest.config.*`, `tsconfig*`,
  `nuxt.config.ts`, lint/formatter config, or `package.json` scripts to make the
  suite pass. Fix source, not tooling.
- **NFR2 — Suite stays green and typecheck clean.** After all changes,
  `npm run test` and `npx nuxi typecheck` both pass locally and in CI.
- **NFR3 — Cross-platform.** Test changes and the CI job must not assume a
  developer has hledger; the F3 guard keeps local runs green without it.
- **NFR4 — No type escapes.** No `any`/`as any`/unnecessary `as` introduced in
  production code; `any` in test mocks is acceptable per project convention.
- **NFR5 — Net simplification.** Retiring `addTransaction` should reduce total
  production LOC (one fewer write path), not add a parallel one.

## Out of scope

- Rewriting or expanding the journal-writer test coverage beyond what R3/R6
  require.
- Adding new product features or API routes.
- Broad coverage backfill for paths already classified as well-covered (R5.2).
- Upgrading hledger pinning strategy beyond "a working hledger on CI" (distro
  package is acceptable per design).
- Any change to the `typecheck` job (R4.5).
