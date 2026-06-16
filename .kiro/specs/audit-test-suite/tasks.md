# Tasks — Audit the test suite

> Implements `design.md` + `requirements.md` in this folder. GitHub Issue #11.
> Branch: `feat/audit-test-suite` (or continue current `chore/audit-test-suite`).
> Order matters: migrate production first (T1), then delete the dead function
> (T2), then fix the tests that referenced it (T3–T5), then CI (T6), then the
> coverage test (T7), then the written audit deliverable (T8), then the final
> green checkpoint (T9). Each task is independently verifiable.

---

- [x] **T1 — Migrate `categories.post.ts` to `appendTransaction`** *(R1.1, R1.2, R1.4, R2.2, R2.3)*
  - File: `server/api/categories.post.ts`.
  - Replace both `addTransaction({...})` calls (create + close) with
    `appendTransaction({...})`; add the `import { appendTransaction }` (the
    function lives in `server/utils/journalWriter`).
  - **Keep** the manual `fieldHasIllegalChars` pre-check and its friendly 400
    (R2.2). Update its comment — it no longer compensates for `addTransaction`
    skipping validation; it now provides a category-specific message on top of
    `validateTransaction`.
  - Preserve the response contract: `201` + `{ success: true, account }`.
  - Note: zero-amount balanced postings already satisfy `validateTransaction`
    (explicit amounts summing to 0 cents → passes).
  - Verify: typecheck the file; covered end-to-end by T4/T5 tests.

- [x] **T2 — Delete the legacy `addTransaction` function** *(R1.3, NFR5)*
  - File: `server/utils/hledger.ts` — remove `export async function
    addTransaction`.
  - Grep the tree for any remaining `addTransaction` reference (`rg
    addTransaction`); after T1 the only hits should be the test stubs handled in
    T4/T5. Production must have zero references.
  - Verify: `npx nuxi typecheck` clean (no dangling references in prod code).

- [x] **T3 — Remove gated/legacy tests F1 + F2 from `hledger.test.ts`** *(R3.1, R3.2, R3.3, R3.4)*
  - File: `server/utils/__tests__/hledger.test.ts`.
  - Delete the `describe.skip('addTransaction rejects invalid input')` block (F1)
    and the `describe.skipIf(!hledgerAvailable)('addTransaction round-trip')`
    block (F2).
  - Drop the now-unused `addTransaction` import.
  - **Keep** `checkHledgerAvailable()`, the `hledgerAvailable` const, and the F3
    timeout-kill test with its `if (!hledgerAvailable) return` guard intact.
  - **F4 (found at T2):** also delete the
    `it('Property 4: addTransaction only spawns hledger processes…')` test
    (≈ line 426) — it asserts `addTransaction` exists in source and breaks once
    T2 removes the function. **Keep** the other two `it`s in the
    `describe('hledger is the sole journal writer')` block (no `fs` writes / no
    `fs` import — still valid module invariants). *(R3.6)*
  - Verify: `npx vitest run server/utils/__tests__/hledger.test.ts` — passes,
    F3 still present, the two journal-writer-invariant tests still present.

- [x] **T4 — Repoint `api-routes.test.ts` stub** *(R3.5)*
  - File: `server/api/__tests__/api-routes.test.ts` (≈ line 22).
  - Change `vi.stubGlobal('addTransaction', …)` to stub `appendTransaction`
    (the global the migrated route now calls).
  - Verify: `npx vitest run server/api/__tests__/api-routes.test.ts` passes.

- [x] **T5 — Repoint `categories-security.test.ts` stub + keep the security assertion** *(R2.1, R3.5)*
  - File: `server/api/__tests__/categories-security.test.ts` (≈ line 13).
  - Stub `appendTransaction` instead of `addTransaction`.
  - **Load-bearing:** the test MUST still assert that a malicious category name
    (containing `\r`/`\n`/`\t`) is rejected with `400` and that nothing is
    written. If the existing assertions only checked the old guard, ensure at
    least one case proves R2.1 survives the migration.
  - Verify: `npx vitest run server/api/__tests__/categories-security.test.ts`
    passes; deliberately confirm the injection case still fails the request.

- [x] **T6 — Add a `test` job to CI with hledger** *(R4.1, R4.2, R4.3, R4.4, R4.5)*
  - File: `.github/workflows/ci.yml`.
  - Add a `test` job sibling to `typecheck` (same `push`/`pull_request` → `main`
    triggers): checkout → `actions/setup-node@v4` node 20 + npm cache →
    `npm ci` → `sudo apt-get update && sudo apt-get install -y hledger` →
    `hledger --version` (verification gate, R4.3) → `npm run test`.
  - Install runs every invocation, no caching (R4.2 rationale).
  - Do **not** touch the `typecheck` job (R4.5).
  - Verify: `yq`/manual YAML read for shape; real validation is the PR's CI run
    (note in PR that F3 should now execute for real).

- [x] **T7 — Add the non-default-base assign route test** *(R6.1)*
  - File: `server/api/__tests__/budget-endpoints.test.ts` (existing assign
    coverage lives here).
  - Add a case: call the `budget/assign` handler with
    `physicalAccount: 'assets:savings'` and a one-envelope map; stub
    `appendTransaction` to capture the `TransactionInput`; assert the envelope
    posting account is `assets:savings:budget:<category>` and the offset is
    `toUnallocatedAccount('assets:savings')` with the negated total.
  - No live hledger. If this proves unexpectedly hard (R6.2), stop, document the
    deferral in T8's outcome, and leave a `// TODO(#11 follow-up)` — do not force it.
  - Verify: `npx vitest run server/api/__tests__/budget-endpoints.test.ts` passes.

- [x] **T8 — Write the audit outcome deliverable** *(R5.1, R5.2, R5.3, R6.2 if triggered)*
  - File: `.kiro/specs/audit-test-suite/outcome.md` (new).
  - Record: F1–F3 verdicts + rationale (keep/delete, what replaced them); a
    coverage map of production read/write paths → covering test file(s); any
    flagged-but-unclosed gaps as explicit follow-ups (e.g. register seeding /
    envelope routing inventory, and the `transfer` non-issue from R6 scoping).
  - If T7 was deferred, state why here.

- [x] **T9 — Final green checkpoint** *(NFR1, NFR2, NFR4)*
  - Run the full suite once: `npm run test` — all pass.
  - Run `npx nuxi typecheck` — clean.
  - Confirm no tooling config (`vitest.config.*`, `tsconfig*`, `nuxt.config.ts`,
    lint, `package.json` scripts) was modified (NFR1) and no `any`/`as any`
    entered production code (NFR4).
  - Update `AI-MAP.md` if the `addTransaction` removal changes the documented
    server-util surface.

---

### Coverage matrix (every requirement lands on a task)

| Requirement | Task(s) |
|---|---|
| R1.1 / R1.2 / R1.4 | T1 |
| R1.3 | T2 |
| R2.1 | T5 |
| R2.2 | T1 |
| R2.3 | T1 |
| R3.1 / R3.2 / R3.3 / R3.4 / R3.6 | T3 |
| R3.5 | T4, T5 |
| R4.1–R4.5 | T6 |
| R5.1 / R5.2 / R5.3 | T8 |
| R6.1 | T7 |
| R6.2 | T7 (escape hatch) → T8 (documented) |
| NFR1 / NFR2 / NFR4 | T9 |
| NFR3 | T3 (F3 guard), T6 (CI provides hledger) |
| NFR5 | T2 |
