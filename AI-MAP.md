# AI-MAP — FinanceApp

Quick navigation map for agents. **Consult this before grepping/finding.** It's a
living document — update it when the project's shape changes (see
`.claude/steering/ai-map-reference.md`). For the full design rationale, read
`.kiro/steering/hledger-budget-app-design.md`.

## Tech stack
- Nuxt 4 (`nuxt ^4.3.1`), `compatibilityDate: 2025-01-01`, ESM.
- Nuxt UI v4.5.1 (`@nuxt/ui`) — Dashboard components. Theme: green / zinc, Public Sans.
- TypeScript strict + `noUncheckedIndexedAccess`. Vitest + fast-check.
- Engine: **hledger CLI** + plain-text `.journal` files (path from `LEDGER_FILE`,
  default `test-data/sample.journal`).

## Run / build / test
- `npm run dev` — dev server at http://localhost:3000 (needs hledger on PATH)
- `npm run test` — `vitest run`
- `npm run build` / `npm run preview`
- `npx nuxi typecheck` — root `tsconfig.json` extends `./.nuxt/tsconfig.json`.
  **Clean (0 errors) and CI-gated** via `.github/workflows/ci.yml` (typecheck-only
  job on push/PR to `main`; no test job yet — Issue #10).

## Data flow
`Pages/Components → composables → server/api → server/utils → hledger CLI / .journal`
Reads: `hledgerExec` (`-O json`) / `hledgerExecText` (accounts cmd, no JSON) →
transformed server-side to `types/`. Writes: `appendTransaction` (validate →
format → `fs.appendFile`). Deletes: edit journal by transaction index
(**writable journal must be a single flat file — `include` directives are
rejected on delete and upload**, since they break the date-line ↔ tindex mapping).

## Pages (`pages/`)
| Route | File | Purpose |
|---|---|---|
| `/` | `index.vue` | Dashboard placeholder (hidden from nav) |
| `/budget` | `budget.vue` | Envelope budget — Ready to Assign, groups, Assigned/Activity/Available, inline assign |
| `/reports` | `reports.vue` | Placeholder (hidden) |
| `/settings` | `settings.vue` | Journal mgmt (create/upload/export/list/activate) |
| `/accounts` | `accounts/index.vue` | Add/delete real accounts |
| `/accounts/:path` | `accounts/[...path].vue` | Account register + transaction form |

## Components / layout
- `components/AccountRegister.vue` — YNAB register table (Date, Payee, Envelope, Inflow, Outflow, Balance). For a real account the register is **family-aggregated**: rows net the account + its `:budget:*` envelopes, so Balance = the real bank balance and internal moves (assignments, envelope transfers) drop out.
- `components/SimplifiedTransactionForm.vue` — Add-transaction modal (Account, Payee, Envelope, Inflow/Outflow).
- `layouts/default.vue` — UDashboardGroup + sidebar + real-accounts UTree.

## Composables (`composables/`) — data fetch
`useAccounts(type?)`, `useBalances(query?)`, `useBudget(period?)`,
`useTransactions(query?)` + `useRegister({account})`, `useReports` →
`useIncomeStatement` / `useBalanceSheet` (placeholder).

## API surface (`server/api/`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/accounts?type=` | Account names (real/category/all; real excludes `:budget:`) |
| GET | `/api/balances` | Balances (transformed) |
| GET | `/api/transactions` | RegisterRow[] when account filter, else HledgerTransaction[] |
| POST | `/api/transactions` | Add (envelope-aware; CC expense → 4 postings) |
| DELETE | `/api/transactions?index=N` | Delete by journal index |
| GET | `/api/budget?period=` | BudgetEnvelopeReport — Ready to Assign, Assigned/Activity/Available |
| POST | `/api/budget/assign` | Assignment txn (**unallocated pool → envelope**; inverse of reduce) |
| POST | `/api/budget/transfer` | Move between envelopes |
| POST | `/api/categories` | Create expense groups/envelopes |
| GET·POST | `/api/hidden-envelopes` | List / hide-unhide (zero balance to hide) |
| * | `/api/journal/{create,upload,export,activate,list}` | Journal file management |

## Server utils (`server/utils/`, Nitro auto-imported)
- `hledger.ts` — `resolveJournalPath` (precedence: `config/active-journal.json`
  → `LEDGER_FILE` → `test-data/sample.journal`), `hledgerExec`, `hledgerExecText`,
  `transformTransactions`, `transformBalanceReport`,
  `resolveBudgetBase`/`DEFAULT_BUDGET_BASE` (derive the asset account hosting the
  `:budget:` tree, Issue #4). All hledger spawning goes through a private
  `runHledger` helper: rejects on spawn `error`/timeout (`HLEDGER_TIMEOUT_MS`,
  default 30s) so a missing/hung hledger never hangs the request; binary
  overridable via `HLEDGER_BIN`; stdout collected with `Buffer.concat`.
  Re-exports `SAMPLE_JOURNAL`/`ACTIVE_JOURNAL_CONFIG`. Guard-tested to never import `fs`.
- `fsExists.ts` — `pathExists` (async `fs.access` wrapper; replaces `existsSync`
  in request handlers, Issue #4).
- `activeJournal.ts` — owns reading `config/active-journal.json` (`readActiveJournalPath`)
  + the `SAMPLE_JOURNAL`/`ACTIVE_JOURNAL_CONFIG` constants (kept out of `hledger.ts`).
- `budgetData.ts` — `getReadyToAssign` (YNAB Rule 1: net worth − envelopes) +
  `READY_TO_ASSIGN_EPSILON`. Single source of truth for "Ready to Assign", shared
  by `GET /api/budget` and the `budget/assign` availability gate (Issue #7).
- `journalWriter.ts` — `validateTransaction`, `formatTransaction`, `appendTransaction`,
  `fieldHasIllegalChars` (rejects `\r\n\t` in free-text fields — journal-injection guard).
- `journalFiles.ts` — `JOURNALS_DIR`, `safeJournalPath` (path-traversal guard for
  create/upload/activate; throws 400 on separators/`..`/bad extension).
- `hledgerArgs.ts` — pure `isValidDate`/`isValidPeriod`/`isValidAccount` (arg-injection
  guards for read-route query params).

## Pure utils (`utils/`) — property-tested
`formatAmount`, `stripAccountPrefix`, `buildAccountTree`, `filterAccounts`
(`filterRealAccounts`/`filterCategoryAccounts`), `deriveTransactionType`,
`validateSimplifiedForm`, `toTransactionInput` (transfers honor a `direction`
field — inflow vs outflow column), `toRegisterRows` (family-aggregated; flags
multi-commodity rows; optional `openingBalance` seed for date-filtered registers,
Issue #4), `budgetAccounts` (`toBudgetSubAccount`/`isBudgetSubAccount`/
`toUnallocatedAccount`/…), `singleQuantity` (`MultiCommodityError` guard against
silently dropping commodities), `validateTransactionForm` (legacy).

## Types (`types/`)
`hledger.ts` (HledgerAmount/Posting/Transaction), `api.ts` (TransactionInput,
PostingInput, BalanceQuery, TransactionQuery), `ui.ts` (SimplifiedTransactionInput,
RegisterRow, BudgetCategory/Group, BudgetEnvelopeReport, RealAccount, AccountTreeItem).

## Known quirks / gotchas
- **Windows CRLF:** hledger text output → `split(/\r?\n/)` + trim, else `\r` leaks (`%0D` in URLs).
- **`accounts` has no `-O json`** → use `hledgerExecText`.
- **No `= $0.00` assertion** in single-envelope budget assigns (hledger rejects).
- **Money is handled in integer cents** at the write boundary (`journalWriter`):
  balance is validated and amounts formatted via cents, so journals never go
  unbalanced from float drift. Amount transforms prefer `decimalMantissa`/
  `decimalPlaces` over lossy `floatingPoint`.
- **Writable journal = single flat file** — `include` is rejected on delete/upload.
- **`AccountRegister` emits `edit`/`delete` with a numeric index** (`row.original.transactionIndex`) — page handlers must accept `number`, not an object. (A prior `deleteTx({ transactionIndex })` mismatch silently sent `index: undefined`; fixed + guarded by the typecheck gate — Issue #10.)
- **UTree leaf nodes** need `children: undefined` (not `[]`) to be selectable.
- **UCard slots:** `header` / default / `footer` — there is no `#body`.
- **tsconfig** must extend `./.nuxt/tsconfig.json` for typecheck.
- **Input validation (Issue #2):** free-text journal fields reject `\r\n\t`
  (`fieldHasIllegalChars`); journal filenames must pass `safeJournalPath` (no
  traversal); `activate` only accepts files inside `JOURNALS_DIR` or the sample;
  read-route query params (`account`/`startDate`/`endDate`/`period`) are validated
  via `hledgerArgs` and account queries are passed after a `--` separator.
- **Active journal** is persisted to `config/active-journal.json` (gitignored),
  not `process.env` — set by `journal/activate.post`, read by `resolveJournalPath`.
- **Robustness (Issue #4):** hledger spawns time out / reject (never hang) via
  `runHledger`; simplified `POST /api/transactions` rejects non-positive/non-finite
  amounts; the budget base is **derived** (`resolveBudgetBase`), not hardcoded
  `assets:checking`; date-filtered registers seed the opening balance from
  `bal -e <startDate>`. `HLEDGER_BIN`/`HLEDGER_TIMEOUT_MS` env overrides exist.

## Tests
Beside source: `*.test.ts` (unit), `*.property.test.ts` (fast-check). API tests
under `server/**/__tests__/`. Mock Nitro globals with `vi.stubGlobal()`.
