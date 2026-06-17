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
| `/budget` | `budget.vue` | Envelope budget — Ready to Assign, groups, Assigned/Activity/Available, inline assign. **AI assistant** in a slideover (Issue #8) |
| `/reports` | `reports.vue` | Placeholder (hidden) |
| `/settings` | `settings.vue` | Journal mgmt (create/upload/export/list/activate) + **AI Assistant** API-key config (Issue #8) |
| `/accounts` | `accounts/index.vue` | Add/delete real accounts |
| `/accounts/:path` | `accounts/[...path].vue` | Account register + transaction form |

## Components / layout
- `components/AccountRegister.vue` — YNAB register table (Date, Payee, Envelope, Inflow, Outflow, Balance). For a real account the register is **family-aggregated**: rows net the account + its `:budget:*` envelopes, so Balance = the real bank balance and internal moves (assignments, envelope transfers) drop out.
- `components/SimplifiedTransactionForm.vue` — Add-transaction modal (Account, Payee, Envelope, Inflow/Outflow).
- `components/AiChatPanel.vue` — AI budgeting chat (Issue #8). Nuxt UI chat input + message bubbles + **proposed-action cards** (Approve/Reject) + persistent data-egress notice + no-API-key empty state. Emits `committed` (budget page refreshes). All logic via `useAiChat`.
- `layouts/default.vue` — UDashboardGroup + sidebar + real-accounts UTree.

## Composables (`composables/`) — data fetch
`useAccounts(type?)`, `useBalances(query?)`, `useBudget(period?)`,
`useTransactions(query?)` + `useRegister({account})`, `useReports` →
`useIncomeStatement` / `useBalanceSheet` (placeholder).
`useAiChat({onCommitted?})` (Issue #8) — client for `/api/ai/chat` + the existing
assign/transfer endpoints. Holds the opaque Anthropic history; `send`/`approve`/
`reject`. **Money is committed only here on user approval** (chat route never
writes); auto-rejects un-acted proposals on a new message.

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
| POST | `/api/ai/chat` | AI budgeting chat tool loop (Issue #8). **Never writes** — read tools run server-side; assign/transfer are *proposed* for HITL approval. Stateless (opaque history round-trips). 503 if no key configured |
| GET·POST·DELETE | `/api/ai/config` | AI key status / save / clear (Issue #8). Returns `{configured, source, maskedKey}` — **never the full key**. Save takes effect with no restart |
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
- `budgetReport.ts` — `getBudgetReport(period)` (Issue #8): the envelope-report
  computation extracted from `budget.get.ts` so the route AND the AI `get_budget`
  tool share one source (no duplicated accounting).
- `transactionList.ts` — `getTransactionList(query)`: compact `{date,payee,amount,account}`
  list for the AI `get_transactions` tool; reuses `hledgerExec`+`transformTransactions`.
- `anthropic.ts` — shared Anthropic SDK client (`getAnthropic`, `MissingApiKeyError`,
  `MODEL='claude-opus-4-8'`, `REQUEST_DEFAULTS`: adaptive thinking, effort medium).
  Key via `resolveApiKey()` = **env override → stored** (`ANTHROPIC_API_KEY` else
  `config/ai-config.json`); `getApiKeySource()` reports `env`/`config`/`none`.
  Client rebuilds when the resolved key changes (saving a key needs no restart).
  Reused by future CSV import (#9).
- `aiConfig.ts` — owns the gitignored `config/ai-config.json` (Issue #8):
  `readStoredApiKey` (sync, guarded, never throws — like `activeJournal.ts`),
  `writeStoredApiKey`/`clearStoredApiKey` (async), `maskApiKey` (last-4). The key
  is never logged and never returned in full.
- `aiTools.ts` — AI tool defs + dispatch (Issue #8). `TOOLS` (cache-controlled
  prefix), `READ_TOOL_HANDLERS` (delegate to budgetReport/transactionList),
  `isProposedActionTool`, `toProposedAction` (resolves the budget host, builds the
  assign/transfer payload — **builds a proposal, never writes**).
- `server/ai/budgetInstructions.ts` — `BUDGET_SYSTEM_PROMPT` (cached system prefix:
  YNAB Rule 1, envelope conventions, propose-never-execute, tone).

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
RegisterRow, BudgetCategory/Group, BudgetEnvelopeReport, RealAccount, AccountTreeItem),
`ai.ts` (Issue #8: AssignProposalPayload, TransferProposalPayload, ProposedAction,
ChatResolution, AiChatRequest/Response, ChatDisplayMessage — `messages` is opaque
Anthropic `MessageParam[]`, cast at the SDK boundary in `chat.post.ts`).

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
- **AI chat (Issue #8) — HITL invariant:** `/api/ai/chat` NEVER writes the journal.
  Read tools (`get_budget`/`get_transactions`) run server-side; assign/transfer are
  *proposed* and surfaced for approval — only the existing `budget/assign|transfer`
  endpoints (called by `useAiChat` after the user clicks Approve) write. Guarded by
  `chat.post.test.ts` (asserts the journal writer is called 0×). API key via
  `resolveApiKey()` = `ANTHROPIC_API_KEY` env **override** → in-app key in
  gitignored `config/ai-config.json` (set on the Settings page, no restart);
  server-only, never logged, never returned in full (masked last-4). Model
  `claude-opus-4-8`, non-streaming, manual tool loop (capped at 8 iterations).
  **Data egress:** chat + budget data go to the Anthropic API (the one external
  flow); the panel shows a persistent notice.
- **Robustness (Issue #4):** hledger spawns time out / reject (never hang) via
  `runHledger`; simplified `POST /api/transactions` rejects non-positive/non-finite
  amounts; the budget base is **derived** (`resolveBudgetBase`), not hardcoded
  `assets:checking`; date-filtered registers seed the opening balance from
  `bal -e <startDate>`. `HLEDGER_BIN`/`HLEDGER_TIMEOUT_MS` env overrides exist.

## Tests
Beside source: `*.test.ts` (unit), `*.property.test.ts` (fast-check). API tests
under `server/**/__tests__/`. Mock Nitro globals with `vi.stubGlobal()`.
