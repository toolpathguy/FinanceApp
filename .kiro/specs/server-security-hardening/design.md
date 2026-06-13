# Design — Server Security Hardening

> Implements **GitHub Issue #2** (toolpathguy/FinanceApp): "Security & data
> integrity: journal injection, path traversal, arbitrary-file activation, arg
> injection." The eventual PR body must start with `Fixes #2`.

## Problem framing

The Nitro server layer is the only code that touches the journal file and spawns
hledger. Four input paths trust user data they shouldn't:

| # | Sev | Surface | Risk |
|---|-----|---------|------|
| 1 | High | `journalWriter.formatTransaction` | Unescaped `\n`/`\r` in free-text fields lets a payee forge whole transactions |
| 2 | High | `journal/create.post`, `journal/upload.post` | `join(cwd,'journals',filename)` doesn't strip `../` → write outside dir |
| 3 | High | `journal/activate.post` | Any `existsSync` file becomes the active journal (arbitrary file read) + `process.env` as global state |
| 4 | Med | `transactions.get`, `accounts.get`, `budget.get` | Query params forwarded as raw argv → hledger flag injection (`--debug`, etc.) |

All four are reachable from the unauthenticated API. This spec closes the input
holes; it does **not** add authentication (see Out of scope).

## Guiding approach

- Validation logic lives in **pure functions** (per `separation-of-concerns.md`)
  so it's property-testable and reused across every write/read path.
- Server-side validators live in `server/utils/` (Nitro auto-imported). API
  routes call them at the boundary; they don't inline checks.
- Fail closed with `400`/`404` and a clear message; never silently sanitize
  (silent fixes hide attacker intent and corrupt legitimate-looking data).

---

## Finding 1 — Journal injection

**Cause:** `validateTransaction` only checks accounts are non-empty. `formatTransaction`
writes `description`, `account`, and `commodity` verbatim into the plain-text
journal. A newline in any of them injects forged postings/transactions. Every
write path funnels through `appendTransaction → validateTransaction` **except**
`categories.post.ts`, which builds an `expenses:<name>` account from user input
and writes via `addTransaction` (hledger `add` over stdin) — equally injectable.

**Fix:** Add a pure guard in `journalWriter.ts` and apply it in both write paths.

```ts
// server/utils/journalWriter.ts
const CONTROL_CHARS = /[\r\n\t]/        // newlines + tab (tab is hledger's amount delimiter)
export function fieldHasIllegalChars(value: string): boolean {
  return CONTROL_CHARS.test(value)
}
```

Extend `validateTransaction` with new rules:
- Rule 7: `description` must not contain `\r`, `\n`, or `\t`.
- Rule 8: every posting `account` must not contain those chars.
- Rule 9: every posting `commodity` (when present) must not contain those chars.

`;` (hledger comment char) is intentionally **not** rejected: it's legal in a
payee ("Smith; Co") and, kept on a single line, it can only comment out the rest
of *that same line* — it cannot forge a new transaction. Newline/tab are the
injection primitives. (Documented here so a future reader doesn't "tighten" it.)

`categories.post.ts` doesn't go through `validateTransaction`. Add an explicit
guard there: reject a category `name` containing illegal chars (reuse
`fieldHasIllegalChars`) before constructing the account, returning `400`.

**Why validate, not escape:** hledger has no escape syntax for newlines inside a
description; the only safe transaction is one without them. Rejecting is correct.

---

## Finding 2 — Path traversal in journal file endpoints

**Cause:** `path.join(cwd,'journals', filename)` resolves `..` segments, escaping
the directory. `upload.post` then writes attacker content there; it also skips
the extension check entirely.

**Fix:** One shared pure helper, used by `create`, `upload`, and (Finding 3)
`activate`.

```ts
// server/utils/journalFiles.ts  (new)
import { basename, join, resolve, sep } from 'node:path'

export const JOURNALS_DIR = join(process.cwd(), 'journals')
const EXT = /\.(journal|hledger|j)$/

/** Throws createError(400) if filename is unsafe; returns the safe absolute path. */
export function safeJournalPath(filename: string): string {
  const name = filename.trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Filename is required' })
  if (basename(name) !== name)                      // rejects any separator or ..
    throw createError({ statusCode: 400, statusMessage: 'Filename must not contain a path' })
  if (!EXT.test(name))
    throw createError({ statusCode: 400, statusMessage: 'Filename must end with .journal, .hledger, or .j' })
  const full = resolve(JOURNALS_DIR, name)
  if (full !== join(JOURNALS_DIR, name) || !full.startsWith(JOURNALS_DIR + sep))
    throw createError({ statusCode: 400, statusMessage: 'Resolved path escapes the journals directory' })
  return full
}
```

`basename(name) === name` rejects `../x`, `a/b`, `C:\x`, and absolute paths in
one check; the `resolve`/`startsWith` belt-and-suspenders catches edge cases.
`create.post` and `upload.post` replace their inline `join(...)` with
`safeJournalPath(filename)`. `upload` now also enforces the extension (it didn't
before). The `filename`-omitted branch of `upload` (write to active journal) is
unchanged.

> Note: this helper is server-only (uses `createError`, `node:path`). It lives in
> `server/utils/` per the layering rules, not in the pure `utils/` dir. The
> regex/basename core can still be unit-tested by stubbing `createError`.

---

## Finding 3 — Arbitrary-file activation + global state

**Cause:** `activate.post` accepts any path, only `existsSync`-checks it, then
sets `process.env.LEDGER_FILE`. Two problems: (a) any readable file becomes the
"journal" and is surfaced through every read API; (b) `process.env` as the
source of truth races across requests and is lost on restart.

**Fix (security — required):** Restrict activation to the managed set. The active
file must be either a file inside `JOURNALS_DIR` (validated via `safeJournalPath`)
**or** the bundled `test-data/sample.journal` (which `list.get` already exposes as
selectable). Anything else → `400`. Confirm existence with `existsSync` after the
path is validated, else `404`.

**Fix (state — required):** Stop using `process.env` as the store. Persist the
choice to `config/active-journal.json` (the app already uses `config/` for
`hidden-envelopes.json`). Update `resolveJournalPath()` precedence to:

```
1. config/active-journal.json (if present & readable)   ← set by activate.post
2. process.env.LEDGER_FILE                               ← Docker / initial default
3. 'test-data/sample.journal'                            ← fallback
```

`resolveJournalPath` is sync and called widely, so it reads the config with
`readFileSync` inside a `try/catch` (mirrors `loadHiddenEnvelopes`'s tolerance).
`activate.post` writes the JSON and, for immediacy within the current process,
may also set `process.env.LEDGER_FILE`. This removes the cross-request race and
survives restart. `LEDGER_FILE` stays as the documented Docker default for the
first run before any activation.

**Allowed-target check:**
```ts
// in activate.post
const allowed = (() => {
  if (filename === SAMPLE_JOURNAL) return SAMPLE_JOURNAL          // exact bundled fixture
  try { return safeJournalPath(basename(filename)) } catch { return null }
})()
if (!allowed || !existsSync(allowed)) throw createError({ statusCode: 404, ... })
```

---

## Finding 4 — hledger argument injection

**Cause:** `transactions.get` (`account`, `startDate`, `endDate`), `accounts.get`
(none today, but `type` is internal), and `budget.get` (`period`) forward query
values straight into `spawn('hledger', args)`. No shell, so not RCE — but a value
like `--debug` or `-f /etc/passwd` is parsed as an option, changing or leaking
output.

**Fix:** A new pure validator module + the `--` separator for query terms.

```ts
// server/utils/hledgerArgs.ts  (new, pure — no I/O)
const DATE = /^\d{4}-\d{2}-\d{2}$/
const PERIOD = /^[A-Za-z0-9 \/-]{1,40}$/         // "2025-01", "this month", "2025/01/01-2025/02/01"
const ACCOUNT = /^[A-Za-z0-9:_ -]{1,100}$/        // hledger account-name charset
export function isValidDate(s: string)    { return DATE.test(s) }
export function isValidPeriod(s: string)  { return PERIOD.test(s) && !s.startsWith('-') }
export function isValidAccount(s: string) { return ACCOUNT.test(s) && !s.startsWith('-') }
```

- **Date/period** values are consumed as the argument to `-b`/`-e`/`-p`, so the
  main risk is a leading `-`; validators reject that and constrain the charset.
  Invalid → `400`.
- **Account** is a free query term. Validate the charset **and** pass it after a
  `--` separator so even a hypothetical leading dash can't be read as a flag:
  `['print', '-b', start, '-e', end, '--', account]`. (hledger supports `--`.)

Routes call the validators at the top and `throw createError(400)` on bad input,
then build args. `accounts.get` only branches on an internal `type` enum — no
change needed beyond confirming `type` is matched, not forwarded.

---

## Files touched

| File | Change |
|------|--------|
| `server/utils/journalWriter.ts` | `fieldHasIllegalChars`; rules 7–9 in `validateTransaction` |
| `server/utils/journalFiles.ts` | **new** — `safeJournalPath`, `JOURNALS_DIR` |
| `server/utils/hledgerArgs.ts` | **new** — `isValidDate/Period/Account` |
| `server/utils/hledger.ts` | `resolveJournalPath` precedence (config file → env → default) |
| `server/api/journal/create.post.ts` | use `safeJournalPath` |
| `server/api/journal/upload.post.ts` | use `safeJournalPath` (+ enforce extension) |
| `server/api/journal/activate.post.ts` | allow-list target; persist to `config/active-journal.json` |
| `server/api/categories.post.ts` | reject illegal chars in `name` |
| `server/api/transactions.get.ts` | validate `startDate`/`endDate`/`account`; `--` separator |
| `server/api/budget.get.ts` | validate `period` |
| `config/active-journal.json` | **new at runtime** — gitignored, written by `activate` |

## Edge cases

- Legitimate payees with `;` or unicode are still accepted (only `\r\n\t` blocked).
- `upload` with no `filename` still targets the active journal (unchanged).
- Empty/whitespace `period`/`account` query params: treated as absent (current
  behavior), not an error.
- First run with no `config/active-journal.json`: falls back to `LEDGER_FILE`
  then sample — identical to today's behavior.
- Windows paths: `basename('..\\x')` returns `..\\x` on POSIX but the check is on
  the *received* string; `basename(name) !== name` rejects both `/` and `\` forms
  because we compare against the platform `basename`. The `resolve`+`startsWith`
  check is the cross-platform backstop.

## Alternatives considered

- **Escaping newlines instead of rejecting (Finding 1):** hledger has no
  in-field newline escape; there's no faithful round-trip. Reject is the only
  correct option.
- **Keeping `process.env` and only adding the allow-list (Finding 3):** closes
  the file-read hole but leaves the cross-request race and restart-loss. Cheap to
  also fix via the config file, and it matches the existing `config/` pattern.
- **Whitelist hledger flags instead of `--` (Finding 4):** brittle as hledger
  evolves. `--` + charset validation is simpler and version-robust.
- **Add auth / bind to localhost:** correct for the deployable Docker case but a
  separate product decision; tracked as Out of scope below.

## Out of scope (flag for follow-up)

- **Authentication / network exposure.** The API is unauthenticated and mutates
  disk; `Dockerfile`/`docker-compose.yml` make it deployable. This spec assumes
  the documented **local single-user** model and does not add auth or bind
  changes. Recommend a separate issue to decide: bind to `127.0.0.1` by default,
  or add an auth layer, before any multi-user/hosted deployment.
