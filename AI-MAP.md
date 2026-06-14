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
- `npx nuxi typecheck` — root `tsconfig.json` extends `./.nuxt/tsconfig.json`

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
- `hledger.ts` — `resolveJournalPath`, `hledgerExec`, `hledgerExecText`,
  `transformTransactions`, `transformBalanceReport`, `addTransaction` (legacy).
- `journalWriter.ts` — `validateTransaction`, `formatTransaction`, `appendTransaction`.

## Pure utils (`utils/`) — property-tested
`formatAmount`, `stripAccountPrefix`, `buildAccountTree`, `filterAccounts`
(`filterRealAccounts`/`filterCategoryAccounts`), `deriveTransactionType`,
`validateSimplifiedForm`, `toTransactionInput` (transfers honor a `direction`
field — inflow vs outflow column), `toRegisterRows` (family-aggregated; flags
multi-commodity rows), `budgetAccounts` (`toBudgetSubAccount`/`isBudgetSubAccount`/
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
- **UTree leaf nodes** need `children: undefined` (not `[]`) to be selectable.
- **UCard slots:** `header` / default / `footer` — there is no `#body`.
- **tsconfig** must extend `./.nuxt/tsconfig.json` for typecheck.

## Tests
Beside source: `*.test.ts` (unit), `*.property.test.ts` (fast-check). API tests
under `server/**/__tests__/`. Mock Nitro globals with `vi.stubGlobal()`.
