# Tasks — Server Robustness (GitHub Issue #4)

Ordered, each independently verifiable. Implement top-to-bottom. Run the cited
tests after each task; mark `- [x]` and report before moving on.

> Test runner per `test-execution.md`: run the **specific file**, not the whole
> suite, while iterating. Final task runs the full suite + typecheck.

---

- [x] **T1 — `runHledger` helper: error + timeout + Buffer-safe (R1, R5.1, R5a)**
  - `server/utils/hledger.ts`: add private `runHledger(args, stdin?)` →
    `Promise<{ code, stdout, stderr }>`. Register `proc.on('error', reject)`;
    arm a `HLEDGER_TIMEOUT_MS` (default 30000) timer that `proc.kill()`s + rejects;
    clear the timer on `close`/`error`; guard with a `settled` flag so it settles
    once. Collect `chunks: Buffer[]`, decode via `Buffer.concat(chunks).toString('utf8')`.
  - Rewrite `hledgerExec`, `hledgerExecText`, `addTransaction` as thin wrappers
    over `runHledger` (preserve exit-code/JSON behavior, R1.5).
  - **Tests** (`server/utils/__tests__/hledger.test.ts`): add a `runHledger`/
    `hledgerExec` rejection test for a non-existent binary via a seam (or assert
    reject-not-hang with a short timeout); add a timeout test with a small
    `HLEDGER_TIMEOUT_MS` override. Keep the existing `fs`-guard property test
    green (NFR5). Assert the source no longer contains `stdout += ` / `+= c`.
  - **Covers:** R1.1–R1.5, R5.1.

- [x] **T2 — Positive-amount validation (R2)**
  - `server/api/transactions.post.ts`: in the simplified branch, split the guard
    into a presence check (`date`/`payee`/`account` → "Missing required fields")
    and an amount check (`typeof number && Number.isFinite && > 0` → 400
    "Amount must be a positive number"). Legacy branch untouched.
  - Cross-check `utils/validateTransactionForm.ts` for message/consistency.
  - **Tests** (`server/api/__tests__/api-routes.test.ts` or a new
    `transactions.post.test.ts`): negative, `0`, `NaN`, string, missing → 400
    (correct message); positive → 201 with `appendTransaction` mocked.
  - **Covers:** R2.1–R2.5.

- [x] **T3 — `resolveBudgetBase` + `DEFAULT_BUDGET_BASE` (R3.1–R3.2)**
  - `server/utils/hledger.ts`: add `DEFAULT_BUDGET_BASE = 'assets:checking'` and
    `async resolveBudgetBase(allAccounts?)`. If list omitted, fetch via
    `hledgerExecText(['accounts'])` + `split(/\r?\n/)` + trim (NFR3). Return the
    prefix before `:budget:` on the first `assets:*` match, else the default.
  - **Tests** (`server/utils/__tests__/hledger.test.ts`): pure cases — empty →
    default; `['assets:checking', 'assets:checking:budget:food']` → `assets:checking`;
    `['assets:bank:everyday:budget:rent']` → `assets:bank:everyday`; ignores
    non-asset `:budget:`-like names.
  - **Covers:** R3.1, R3.2.

- [x] **T4 — Wire budget base into CC posting + budget report (R3.3–R3.6)**
  - `transactions.post.ts`: CC branch uses `await resolveBudgetBase()` instead of
    the literal.
  - `budget.get.ts`: derive `base = await resolveBudgetBase(allAccounts)` from the
    already-fetched list (R3.5); replace the four `assets:checking:budget:` usages
    (cumulative query, prefix checks, unallocated, `pending:`) with `${base}:budget:`.
  - **Tests** (`server/api/__tests__/budget-endpoints.test.ts` +
    `budget-data.test.ts`): a fixture with a non-default base (e.g.
    `assets:bank:everyday`) yields correct envelopes + RTA; an `assets:checking`
    fixture is unchanged (R3.6 regression).
  - **Covers:** R3.3–R3.6.

- [x] **T5 — `toRegisterRows` opening-balance seed (R4.1, R4.5)**
  - `utils/toRegisterRows.ts`: add `openingBalance = 0` param; `let runningBalance
    = openingBalance`.
  - **Tests** (`utils/toRegisterRows.test.ts` + `.property.test.ts`): seeded start
    offsets every row's balance by the seed; default `0` keeps all existing
    assertions; property — first row balance = seed + first net.
  - **Covers:** R4.1, R4.5.

- [x] **T6 — Seed query in the register route (R4.2–R4.4)**
  - `server/api/transactions.get.ts`: when `sd && acct`, run
    `hledgerExec(['bal', '-e', sd, '--', acct])`, take `totals[0].quantity ?? 0`,
    pass as the 3rd arg to `toRegisterRows`. No `startDate` → seed `0`.
  - **Tests** (`server/api/__tests__/api-routes.test.ts`): mock `hledgerExec` to
    assert the `bal -e <sd> -- <acct>` call is issued and the first row's
    `runningBalance` includes the seed; no-startDate path issues no seed query.
  - **Covers:** R4.2–R4.4.

- [x] **T7 — `pathExists` helper + replace `existsSync` (R5.2–R5.3)**
  - New `server/utils/fsExists.ts`: `export async function pathExists(p)` via
    `fs/promises.access`.
  - Replace `existsSync` in `budget.get.ts` (`loadHiddenEnvelopes`),
    `hidden-envelopes.post.ts` (`loadHidden` + the `config` dir check),
    `journal/activate.post.ts` (file-not-found check). Drop now-unused `existsSync`
    imports. Leave `activeJournal.ts` as-is (R5.3).
  - **Tests:** unit-test `pathExists` (existing file → true, missing → false);
    assert the three handlers no longer import `existsSync` (or covered by
    existing route tests passing).
  - **Covers:** R5.2, R5.3.

- [x] **T8 — Full verification + map update (NFR4, NFR6)**
  - `npx vitest run` — all green (use the `test-execution.md` filter; drill into
    any failing file individually).
  - `npx nuxi typecheck` — clean (root tsconfig extends `./.nuxt/tsconfig.json`).
  - Update `AI-MAP.md`: note `runHledger`/`resolveBudgetBase`/`DEFAULT_BUDGET_BASE`,
    new `server/utils/fsExists.ts` (`pathExists`), and the timeout/error quirk.
  - **Covers:** NFR1–NFR6 (final gate).

---

## Notes
- **Branch:** `fix/server-robustness` (already created). No commits to `main`.
- **PR (when asked):** body MUST start with `Fixes #4`; mention follow-up **#7**.
- **Subagents** (if used): must not run git; read `AI-MAP.md`, don't write it.
- T3 precedes T4; T5 precedes T6 (consumers depend on the new signatures). T1, T2,
  T7 are independent and could be done in any order.
