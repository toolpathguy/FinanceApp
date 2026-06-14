# Design — Server Robustness (GitHub Issue #4)

## Introduction

This spec addresses the robustness / edge-case findings filed in **GitHub Issue
#4** (`toolpathguy/FinanceApp`), surfaced during an architecture/logic review.
The issues are independent server-side defects; none change product behavior for
the happy path, but each is wrong (or hangs) at an edge. Scope = **all five**
items from the ticket:

1. (high) Spawn errors hang the HTTP request forever.
2. (medium) Amount validation gaps at the API boundary.
3. (medium) Hardcoded `assets:checking` budget base.
4. (medium) Date-filtered running balance starts from $0.
5. (lower) Buffer concatenation + synchronous `existsSync` in handlers.

The fixes stay inside the existing layer boundaries (`separation-of-concerns.md`):
engine/IO concerns in `server/utils`, validation in `server/api`, pure
presentation math in `utils/`.

---

## Item 1 — Spawn errors hang the request (high)

### Problem
`hledgerExec`, `hledgerExecText`, and `addTransaction` (`server/utils/hledger.ts`)
await only the `close` event:

```ts
const code = await new Promise<number>((res) => proc.on('close', res))
```

If the process never spawns (`ENOENT` — hledger not on PATH) or dies before
`close`, the `error` event fires, the promise never settles, and the Nitro
request hangs until the client gives up. There is also no upper time bound on a
hung hledger.

### Solution
Introduce one private helper in `hledger.ts` that owns process lifecycle for all
three call sites:

```ts
interface RunResult { code: number; stdout: string; stderr: string }

function runHledger(args: string[], stdin?: string): Promise<RunResult>
```

The helper:
- `spawn('hledger', args)`.
- Registers `proc.on('error', reject)` so `ENOENT`/spawn failure rejects
  immediately with a clear message (`hledger could not be started: <err>`).
- Arms a timeout (`HLEDGER_TIMEOUT_MS`, default `30000`). On expiry it
  `proc.kill()`s and rejects (`hledger timed out after <n>ms`). The timer is
  cleared on `close`/`error` so it never leaks or fires late.
- Collects stdout/stderr as **`Buffer[]` + `Buffer.concat`** (see Item 5a),
  decoding to UTF-8 once at the end.
- Resolves `{ code, stdout, stderr }` on `close`.

The three public functions become thin wrappers:
- `hledgerExec` → `runHledger([...args, '-f', file, '-O', 'json'])`, throw on
  non-zero `code`, else `JSON.parse(stdout)`.
- `hledgerExecText` → same without JSON.
- `addTransaction` → `runHledger(['add', '-f', file], stdinLines)`.

### Where the clean 500 comes from
Nitro turns an unhandled thrown `Error` in a handler into a 500 automatically.
Today the hang means *no* response; once the promise rejects, the existing
behavior (reject → 500) takes over. We do **not** need to touch every route —
rejecting is the fix. Routes that already wrap writes in try/catch (e.g.
`transactions.post.ts`) keep their 400 mapping for validation errors; engine
failures surface as 500, which is correct.

### Edge cases
- Process emits `error` *after* `close` (rare): timer already cleared, promise
  already settled — second settle is a no-op (guarded by a `settled` flag).
- Timeout fires while data is still streaming: `proc.kill()` triggers `close`
  with a non-zero/`null` code, but we've already rejected — guarded.

---

## Item 2 — Amount validation gaps (medium)

### Problem
`server/api/transactions.post.ts` simplified-input guard:

```ts
if (!body.date || !body.payee || !body.account || !body.amount) { ...400 }
```

`!body.amount` is truthiness, not validity:
- `amount === 0` is **rejected** (legitimate $0 is arguable, but the bug is it's
  conflated with "missing").
- `amount === -5` **passes** the guard, then flows into `applyEnvelopePostings` /
  `toTransactionInput`, where a negative silently inverts posting signs.
- A non-numeric `"abc"` passes truthiness too.

### Solution
Replace the truthiness check with explicit field + numeric validation in the
simplified branch:

```ts
if (!body.date || !body.payee || !body.account) {
  throw createError({ statusCode: 400, message: 'Missing required fields' })
}
if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
  throw createError({ statusCode: 400, message: 'Amount must be a positive number' })
}
```

Rationale for `> 0` (not `>= 0`): in the YNAB model amounts always display
positive and direction is carried by `type` (inflow/outflow). A zero-amount
transaction has no effect and a negative one is an inverted-sign bug, so both are
rejected at the boundary. This matches the existing form validator
(`utils/validateTransactionForm.ts`) — confirm and keep them consistent.

### Edge cases
- Legacy input branch is unchanged (it carries explicit signed postings that
  `validateTransaction` already balances). The fix is scoped to the simplified
  branch where `amount` is a single positive magnitude.

---

## Item 3 — Hardcoded `assets:checking` budget base (medium)

### Problem
Two places assume the budget envelope tree lives literally under
`assets:checking:budget:`:
- `transactions.post.ts` → `applyEnvelopePostings`, the credit-card 4-posting
  branch: `const budgetBase = 'assets:checking'`.
- `budget.get.ts` → every `assets:checking:budget:` query/string prefix.

(The *asset*-expense branch already derives the base from `body.account`, so it's
correct; only the CC branch and the budget reader are wrong.)

A user whose primary asset account is e.g. `assets:bank:everyday` gets
mis-routed envelope postings and an empty budget report.

### Solution — derive the base from the journal (no new config/UI)
The budget base is, by construction, *the asset account that hosts a `:budget:`
sub-tree*. We can derive it from hledger's own account list rather than storing a
setting:

Add to `hledger.ts`:

```ts
/** The asset account that hosts the envelope budget tree, e.g. 'assets:checking'.
 *  Derived from the journal: the prefix before ':budget:' on any asset account.
 *  Falls back to 'assets:checking' when no budget tree exists yet (new journal). */
export async function resolveBudgetBase(allAccounts?: string[]): Promise<string>
```

- If `allAccounts` is supplied (caller already ran `accounts`), use it; else run
  `hledgerExecText(['accounts'])` and split on `/\r?\n/` (Windows CRLF, per
  `tech.md`).
- Find the first `assets:*` account containing `:budget:`; return the substring
  before `:budget:`.
- Fallback: `DEFAULT_BUDGET_BASE = 'assets:checking'` (backward-compatible with
  every existing journal and the sample fixture).

Call sites:
- **`budget.get.ts`**: it already fetches `allAccounts`; pass them to
  `resolveBudgetBase(allAccounts)` (zero extra hledger calls). Replace the four
  literal `assets:checking:budget:` usages with `` `${base}:budget:` `` and the
  unallocated/pending checks accordingly.
- **`transactions.post.ts`** (CC branch): `const budgetBase = await
  resolveBudgetBase()`. One extra `accounts` call only on credit-card expense
  creation — acceptable.

### Alternative considered — explicit config / settings field
Store `primaryAccount` in `config/` (like `active-journal.json`) and read it.
**Rejected as the primary mechanism** because: (a) it adds a settings surface and
a migration for existing users; (b) the journal already encodes the answer
unambiguously (the `:budget:` host), keeping the app a thin layer over hledger;
(c) derivation is self-healing if the user renames their primary account. The
`DEFAULT_BUDGET_BASE` constant leaves an obvious seam to later wire a config
override if a real need appears (e.g. multiple budget hosts).

### Edge cases
- **No budget tree yet** (fresh journal): fallback `assets:checking`. The first
  asset-expense assignment creates the tree under the user's real account via the
  already-correct asset branch; CC-first usage on a non-default account is the
  one residual gap, documented in requirements as out-of-scope-for-now.
- **Multiple `:budget:` hosts**: not a supported state in this app (single budget
  base). We take the first and could `log`/warn later; not in scope.

---

## Item 4 — Date-filtered running balance starts from $0 (medium)

### Problem
`transactions.get.ts` passes `-b startDate` to hledger; `utils/toRegisterRows.ts`
then accumulates `runningBalance` from **0**. With a `startDate`, the Balance
column shows the *windowed* delta, not the true account balance — every row is
wrong by the opening balance.

### Solution — seed the running balance
`toRegisterRows` gains an optional opening-balance parameter (pure, no I/O):

```ts
export function toRegisterRows(
  transactions: HledgerTransaction[],
  accountPath: string,
  openingBalance = 0,        // NEW
): RegisterRow[]
```

`let runningBalance = openingBalance` — default `0` preserves all existing
callers and tests.

`transactions.get.ts` computes the seed only when a `startDate` is present:

```ts
let opening = 0
if (sd && acct) {
  // hledger -e is exclusive: `bal acct -e sd` = balance of all postings strictly
  // before startDate = the window's opening balance for the account family.
  const openingRaw = await hledgerExec(['bal', '-e', sd, '--', acct])
  const report = transformBalanceReport(openingRaw)
  opening = report.totals?.[0]?.quantity ?? 0
}
...
return toRegisterRows(transactions, acct, opening)
```

`acct` is already validated (`isValidAccount`) and passed after `--`, so the
seed query reuses the exact same injection-safe path as the main `print`.

### Why family total is the right seed
The register tracks the *net family balance* (account + its `:budget:`/sub-
accounts); internal net-zero moves don't change it. `hledger bal acct` totals the
family by default (account-name prefix match), so its `-e sd` total is exactly the
cumulative net as of the day before the window — the correct seed.

### Edge cases
- **No `startDate`** (full history): seed stays 0, balance is correct as today.
- **`endDate` only**: unaffected — opening is still the true start (history from
  the beginning).
- **Multi-commodity opening balance**: `transformBalanceReport` totals may carry
  >1 commodity. We take the `$` (first) total consistent with the rest of the
  register, which already degrades gracefully to a "Multiple currencies" row for
  mixed postings. Documented; full multi-commodity registers are out of scope.

---

## Item 5 — Lower-severity (buffer + sync IO)

### 5a. Buffer concatenation
`stdout += c` coerces each raw `Buffer` chunk via `toString()`; a multi-byte
UTF-8 sequence split across chunk boundaries corrupts. Fixed *for free* by the
Item 1 `runHledger` helper: collect `chunks: Buffer[]`, then
`Buffer.concat(chunks).toString('utf8')` once. (Equivalent to
`setEncoding('utf8')`; we use `Buffer.concat` for explicitness.)

### 5b. `existsSync` in handlers
Synchronous IO in async request handlers blocks the event loop. Replace with an
async existence check. Add a tiny shared helper (co-located where the readers
live — a `server/utils/fsExists.ts`, auto-imported by Nitro):

```ts
import { access } from 'node:fs/promises'
export async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}
```

Replace `existsSync` in:
- `budget.get.ts` (`loadHiddenEnvelopes`)
- `hidden-envelopes.post.ts` (`loadHidden`, `saveHidden`'s `existsSync('config')`)
- `activate.post.ts` (the file-not-found check)

> **Note on `activeJournal.ts`**: `readActiveJournalPath()` uses `readFileSync`
> *intentionally* — it's called from the synchronous `resolveJournalPath()` on a
> hot path and is guarded against throwing. Converting it to async would ripple
> through every `hledgerExec` call. **Left as-is**; it's not in the issue and the
> sync read of a tiny local config is acceptable. (Flagged here so a reviewer
> doesn't think it was missed.)

---

## Files touched (summary)

| File | Item(s) | Change |
|------|---------|--------|
| `server/utils/hledger.ts` | 1, 3, 5a | `runHledger` helper (error+timeout+Buffer.concat); rewrite 3 callers; add `resolveBudgetBase` + `DEFAULT_BUDGET_BASE` |
| `server/utils/fsExists.ts` (new) | 5b | `pathExists` helper |
| `server/api/transactions.post.ts` | 2, 3 | positive-number amount validation; derive CC budget base |
| `server/api/budget.get.ts` | 3, 5b | use `resolveBudgetBase`; `pathExists` |
| `server/api/transactions.get.ts` | 4 | compute opening-balance seed |
| `utils/toRegisterRows.ts` | 4 | `openingBalance` param |
| `server/api/hidden-envelopes.post.ts` | 5b | `pathExists` |
| `server/api/journal/activate.post.ts` | 5b | `pathExists` |

## Testing strategy (detail in tasks.md)
- **Item 1**: unit-test `runHledger` error path by spawning a non-existent
  binary name via a seam, or assert `hledgerExec` rejects (not hangs) when
  `hledger` is absent — gated like the existing `describe.skipIf`. Add a timeout
  test with a tiny override.
- **Item 2**: route test — negative, zero, `NaN`, string amounts → 400; positive
  → 201 (mock `appendTransaction`).
- **Item 3**: unit-test `resolveBudgetBase` over account lists (default fallback;
  `assets:bank:everyday:budget:*` → `assets:bank:everyday`). Budget-endpoint test
  with a non-default base.
- **Item 4**: pure unit/property test on `toRegisterRows` seeding; route test
  asserting the `-e startDate` bal query is issued and seeds the first row.
- **Item 5a**: assert `hledger.ts` no longer contains `+= c`/`stdout +=`; covered
  by Item 1 tests. **5b**: assert no `existsSync` import remains in the three
  handlers (and the `fs.ts` guard test still passes — `hledger.ts` must not import
  `fs`).
- Full `npx vitest run` + `npx nuxi typecheck` clean at the end.

## Out of scope
- Settings UI / config for primary account (derivation suffices now).
- Full multi-commodity register support.
- Converting `activeJournal.ts`'s intentional sync read.
- CC-expense-first on a non-default base before any budget tree exists.
