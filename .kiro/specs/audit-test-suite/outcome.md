# Outcome — Audit the test suite

> The durable deliverable of Issue #11. Records the verdict for every
> gated/legacy test found, a coverage classification of production paths, and the
> gaps left as explicit follow-ups. Written after implementing `tasks.md`.

## 1. Gated / legacy test verdicts

| Finding | Test | Verdict | What replaced it |
|---|---|---|---|
| **F1** | `hledger.test.ts` `describe.skip('addTransaction rejects invalid input')` | **DELETED** | Asserted hledger-engine behavior we don't own (`hledger add` silently zeroes unbalanced postings). The real guarantee — rejecting an unbalanced write — lives on the production path and is covered by `journalWriter.test.ts` ("does not sum to zero", "one-cent imbalance"). |
| **F2** | `hledger.test.ts` `describe.skipIf(!hledgerAvailable)('addTransaction round-trip')` | **DELETED** | Exercised the legacy `hledger add` write path. Production writes go through `appendTransaction`; its round-trip is covered by `journalWriter.property.test.ts` and `journal-roundtrip.property.test.ts`. |
| **F3** | `hledger.test.ts` `HLEDGER_TIMEOUT_MS=1` timeout-kill test (with `if (!hledgerAvailable) return`) | **KEPT** | Genuinely needs a real hledger process; can't be faked cross-platform. Guard stays for local dev; **CI now installs hledger** so it runs for real (was silently no-op'ing). |
| **F4** | `hledger.test.ts` `it('Property 4: addTransaction only spawns hledger processes…')` | **DELETED** | Found during implementation, not the original skip/gate sweep — it was coupled to `addTransaction` existing in source. Removed with the function. The two sibling tests in `describe('hledger is the sole journal writer')` (no `fs` writes / no `fs` import) were **kept** — still-valid module invariants. |

**Net production change:** the legacy `addTransaction` (`hledger add` over stdin)
was retired. `categories.post.ts` now writes via `appendTransaction` (the direct
journal writer), so there is **one** write path, not two. The route keeps an
explicit `fieldHasIllegalChars` pre-check for a friendly 400; `validateTransaction`
inside `appendTransaction` is the backstop.

## 1b. Latent bug the new CI job immediately caught

Adding the `test` job paid off on the very first run: it exposed a **real
cross-platform path-traversal hole** that local Windows runs structurally could
not catch. `safeJournalPath` (`server/utils/journalFiles.ts`) used the platform
`basename` to detect path separators. On POSIX that is `path.posix.basename`,
which treats `\` as an ordinary filename character — so `a\x.journal` was
rejected on Windows but **accepted on Linux** (the server's likely deployment
OS). Fix: detect separators with `win32.basename` (strict: `/`, `\`, and `C:`
drive prefixes) so path-bearing names are rejected identically on every OS. The
matching test's sanity helper had the same platform dependency and was switched
to an explicit `/[\\/]/` check; the load-bearing "must throw" assertion was
unchanged. This is exactly the class of silent gap Issue #11 set out to remove.

## 2. CI gap closed

Before: `ci.yml` had a `typecheck` job only — **the entire test suite never ran
in CI.** After: a sibling `test` job runs `npm ci` → install hledger →
`hledger --version` (fail-loud gate) → `npm run test`. Install runs every time
and is not cached (ephemeral runners; a stale cache could reintroduce the silent
skip).

## 3. Production path coverage classification

| Path | Covering test(s) | Status |
|---|---|---|
| Direct journal writer (`validate`/`format`/`appendTransaction`) | `journalWriter.test.ts`, `journalWriter.property.test.ts`, `journal-roundtrip.property.test.ts` | **Well covered** ✓ |
| `transactions.post` / `.get` / `.delete` | `api-routes.test.ts`, `transactions.delete.test.ts` | **Well covered** ✓ |
| `balances.get`, `accounts.get` | `api-routes.test.ts` | **Covered** ✓ |
| `budget.get` (incl. budget-base derivation) | `migration.test.ts`, `budget-data.test.ts`, `budget-data.property.test.ts` | **Well covered** ✓ |
| `budget/assign` + `budget/transfer` | `budget-endpoints.test.ts` (+ `.property`), `migration.test.ts` | **Well covered** ✓ — incl. **non-default budget base** for assign (added this PR, R6.1) |
| `categories.post` (control-char guard + happy path) | `categories-security.test.ts` | **Covered** ✓ |
| `hledgerExec` / `hledgerExecText` (read adapter, timeout, args) | `hledger.test.ts`, `hledgerArgs.test.ts`, `read-args-security.test.ts` | **Covered** ✓ (timeout test now runs in CI) |
| Journal file mgmt: `journal/activate`, `journal/upload`, file listing | `activate-security.test.ts`, `upload.post.test.ts`, `journal-files-security.test.ts` | **Covered** ✓ |
| Pure utils (format, tree, register, strip, derive, validate forms) | matching `utils/*.test.ts` + `*.property.test.ts` | **Well covered** ✓ |

## 4. Gaps left as follow-ups (not closed in this PR)

- **`budget/transfer` non-default base — not applicable, not a gap.** Code review
  at the requirements gate showed `transfer` echoes fully-qualified envelope paths
  verbatim and has no base-resolution logic; there is nothing base-specific to
  assert. R6 was therefore scoped to `assign` only. (See design's "Correction"
  note.)
- **`hidden-envelopes.get` / `hidden-envelopes.post` route handlers** appear only
  *indirectly* in `budget-data` / `migration` tests; no dedicated route test was
  confirmed for the hide/unhide handlers themselves. **Follow-up:** add a route
  test asserting the zero-balance-before-hide rule and the unhide path. (Worth a
  ticket; out of scope for this audit PR.)
- **`journal/create.post` and `journal/export.get`** — confirm direct handler
  coverage (path-traversal cases are covered by `journal-files-security.test.ts`,
  but the create/export happy paths were not individually verified during this
  audit). **Follow-up:** confirm or add.

These are written down rather than silently left — the audit's value is the
classification, not a vow to close every gap in one PR.
