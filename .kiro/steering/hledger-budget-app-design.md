---
inclusion: manual
---

# hledger Budget App — High-Level Design

This is a living design document. Update it as features are built.

## What This App Is

A Nuxt 4 web app that wraps the hledger CLI in a friendly budgeting UI. All accounting logic lives in hledger — the app is a thin layer that executes CLI commands and presents the results using Nuxt UI components.

- Framework: Nuxt 4 (nuxt ^3.16.0 with compatibilityDate 2025-01-01)
- UI: Nuxt UI v4.5.1 (@nuxt/ui) — Dashboard component system (UDashboardGroup, UDashboardSidebar, UDashboardPanel, etc.)
- Data: hledger plain-text journal files on disk
- Runtime: Docker Compose or local dev with hledger installed
- Testing: Vitest + fast-check for property-based testing

## Architecture

```
Browser (Nuxt UI)  →  Nuxt 4 Server (Nitro)  →  hledger CLI  →  .journal files
```

- The frontend talks to Nitro API routes under `/api/`
- Nitro routes spawn `hledger` child processes with `-O json` (for commands that support it)
- The `accounts` command uses text output (no `-O json` support) — parsed via `hledgerExecText`
- hledger reads `.journal` files — the app uses `hledger add` for new transactions and direct file editing for deletes
- Journal file path comes from `LEDGER_FILE` env var (default: `test-data/sample.journal`)
- Server utils in `server/utils/` are auto-imported by Nitro
- Raw hledger JSON is transformed to app types via `transformTransactions` and `transformBalanceReport`

## Project Structure (Current)

```
├── app.vue                          # UApp + NuxtLoadingIndicator + NuxtLayout + NuxtPage
├── app.config.ts                    # UI colors (primary: green, neutral: zinc)
├── nuxt.config.ts                   # @nuxt/ui module, css, devtools
├── tsconfig.json                    # Extends .nuxt/tsconfig.json
├── vitest.config.ts                 # Vitest with esbuild tsconfigRaw workaround
├── assets/css/main.css              # Tailwind theme, @nuxt/ui import, Public Sans font, green palette
├── layouts/
│   └── default.vue                  # UDashboardGroup + UDashboardSidebar + account tree + nav
├── pages/
│   ├── index.vue                    # Dashboard placeholder
│   ├── budget.vue                   # Budget placeholder
│   ├── reports.vue                  # Reports placeholder
│   ├── settings.vue                 # Journal management (create, upload, export, activate)
│   └── accounts/
│       ├── index.vue                # Account management (add/delete accounts)
│       └── [...path].vue            # Account detail (transactions table, balance, add/edit/delete)
├── composables/
│   ├── useAccounts.ts               # GET /api/accounts
│   ├── useBalances.ts               # GET /api/balances with reactive query
│   ├── useTransactions.ts           # GET /api/transactions with reactive query
│   ├── useBudget.ts                 # GET /api/budget (placeholder)
│   └── useReports.ts               # Income statement + balance sheet (placeholder)
├── utils/
│   ├── buildAccountTree.ts          # Flat account paths → hierarchical tree for UTree
│   ├── formatAmount.ts              # { commodity, quantity } → "$1,234.56" or "-$42.00"
│   ├── validateTransactionForm.ts   # Form validation returning error messages
│   └── *.test.ts / *.property.test.ts
├── types/
│   ├── hledger.ts                   # HledgerAmount, HledgerPosting, HledgerTransaction, etc.
│   ├── api.ts                       # TransactionInput, BalanceQuery, TransactionQuery
│   └── ui.ts                        # AccountTreeItem, TransactionFormState, BudgetRow, etc.
├── server/
│   ├── utils/
│   │   └── hledger.ts               # resolveJournalPath, hledgerExec, hledgerExecText,
│   │                                # transformTransactions, transformBalanceReport, addTransaction
│   └── api/
│       ├── accounts.get.ts          # GET /api/accounts (text mode, CRLF-safe)
│       ├── balances.get.ts          # GET /api/balances (with transform)
│       ├── transactions.get.ts      # GET /api/transactions (with transform)
│       ├── transactions.post.ts     # POST /api/transactions
│       ├── transactions.delete.ts   # DELETE /api/transactions?index=N (direct journal edit)
│       └── journal/
│           ├── create.post.ts       # POST /api/journal/create
│           ├── upload.post.ts       # POST /api/journal/upload
│           ├── export.get.ts        # GET /api/journal/export
│           ├── activate.post.ts     # POST /api/journal/activate
│           └── list.get.ts          # GET /api/journal/list
├── test-data/
│   └── sample.journal               # Realistic multi-month test data
└── .kiro/
    ├── specs/hledger-budget-app-ui/ # Spec files (requirements, design, tasks)
    └── steering/                    # This file + git workflow rules
```

## Key Design Decisions

1. Delegate all accounting to hledger — no custom balance calculations
2. New transactions go through `hledger add` via stdin
3. Transaction deletion edits the journal file directly (removes transaction block by index)
4. Transaction editing = delete original + add new (not reversal-based)
5. Use hledger's `--budget` flag for budget vs actuals — no separate budget storage
6. Raw hledger JSON is transformed server-side to match app TypeScript interfaces
7. The `accounts` command uses text output (split on newlines, trim CRLF for Windows)
8. Server utils are plain exported functions — Nitro auto-imports from `server/utils/`
9. Leaf nodes in account tree have `children: undefined` (not empty array) so UTree treats them as selectable items
10. Amount display uses red (text-red-500) for negative and green (text-green-500) for positive values

## YNAB-Style Simplified Transaction Model

The app hides double-entry accounting from the user entirely. The UX follows YNAB's proven model where users think in terms of accounts, payees, categories, and inflow/outflow — never postings or debits/credits.

### Core Concepts

- **Account**: A real-world financial account (checking, savings, credit card). Maps to hledger `assets:*` or `liabilities:*` accounts.
- **Payee**: Who you paid or received money from (e.g., "Grocery Store", "Employer"). Stored in the hledger transaction description.
- **Category**: A budget envelope (e.g., "Groceries", "Rent", "Entertainment"). Maps to hledger `expenses:*` or `income:*` accounts.
- **Inflow**: Money entering an account (positive amount). Used for income, refunds, transfers in.
- **Outflow**: Money leaving an account (positive amount entered by user, stored as negative in hledger). Used for spending, bill payments, transfers out.

### Transaction Types & hledger Mapping

**Expense** (outflow from account to category):
- User enters: Account=Checking, Payee="Coffee Shop", Category=Dining, Outflow=$5.00
- hledger posting 1: `expenses:dining  $5.00`
- hledger posting 2: `assets:checking  -$5.00`

**Income** (inflow to account, category = "Ready to Assign"):
- User enters: Account=Checking, Payee="Employer", Category=Ready to Assign, Inflow=$2000
- hledger posting 1: `assets:checking  $2000.00`
- hledger posting 2: `income:salary  -$2000.00`

**Transfer** (money moves between two accounts, no category):
- User enters: Account=Checking, Payee="Transfer: Savings", Amount=$500
- hledger posting 1: `assets:savings  $500.00`
- hledger posting 2: `assets:checking  -$500.00`
- Transfers have no category — money stays in the budget, just moves between accounts.

### Simplified Transaction Form

The "Add Transaction" modal replaces the raw postings form with:

| Field | Description |
|-------|-------------|
| Date | Transaction date (YYYY-MM-DD) |
| Account | Which account this transaction belongs to (dropdown of user's accounts) |
| Payee | Free text — who you paid or received from |
| Category | Budget category (dropdown). "Ready to Assign" for income. Hidden for transfers. |
| Inflow | Amount entering the account (mutually exclusive with Outflow) |
| Outflow | Amount leaving the account (mutually exclusive with Inflow) |

The app generates the correct 2-posting hledger transaction from these fields. The user never sees or manages postings directly.

### Account Register Display

When viewing an account's transaction list, each row shows:

| Date | Payee | Category | Inflow | Outflow | Running Balance |
|------|-------|----------|--------|---------|-----------------|

- **Payee** comes from the transaction description
- **Category** is derived from the "other" posting's account name (the one that isn't the current account), with the top-level prefix stripped (e.g., `expenses:groceries` → "Groceries")
- **Inflow/Outflow** is determined by the sign of the amount on the current account's posting: positive = inflow, negative = outflow (displayed as absolute value)
- **Running Balance** is a cumulative running total for the account
- Transfers show the other account name as the payee (e.g., "Transfer: Savings") and have no category

### Account List / Sidebar

- The sidebar and accounts page only show "real" accounts (assets + liabilities), not expense/income categories
- Categories (expenses/income accounts) are managed separately in the budget page
- Account balances shown in the sidebar are the net balance from hledger

### Budget Page (Envelope Model)

The budget page follows YNAB's envelope approach:

- **Ready to Assign**: Total unbudgeted money (income received minus total assigned to categories)
- **Category Groups**: Groupings of budget categories (e.g., "Bills", "Everyday", "Savings Goals")
- **Each Category Row**: Shows Assigned (budgeted) | Activity (spent this period) | Available (remaining in envelope)
- Categories map to hledger expense accounts
- "Assigning" money to a category is a virtual allocation — tracked via hledger budget directives or a separate budget config
- Activity is pulled from actual transactions categorized to that expense account

### Category Management

- Categories are the expense/income accounts in hledger (e.g., `expenses:groceries`, `expenses:rent`)
- Users create/rename/delete categories from the budget page, not the accounts page
- The accounts page is strictly for real financial accounts (bank accounts, credit cards)
- This separation mirrors YNAB: accounts ≠ categories

### Display Conventions

- Inflows displayed in green (text-green-500)
- Outflows displayed in red (text-red-500)
- Transfers displayed in neutral color
- All amounts shown as positive numbers — direction indicated by column (Inflow vs Outflow)
- Account names in the UI strip the hledger prefix (e.g., `assets:checking` → "Checking", `liabilities:credit-card` → "Credit Card")

## hledger JSON Transform Layer

hledger's JSON output uses different field names than our TypeScript interfaces:

| hledger JSON | App Interface |
|-------------|---------------|
| `tdate` | `date` |
| `tdescription` | `description` |
| `tindex` | `index` |
| `tstatus` (Cleared/Pending/Unmarked) | `status` (*/!/empty) |
| `tpostings[].paccount` | `postings[].account` |
| `tpostings[].pamount[].acommodity` | `postings[].amounts[].commodity` |
| `tpostings[].pamount[].aquantity.floatingPoint` | `postings[].amounts[].quantity` |

Balance report JSON is a tuple `[[rows...], [totals...]]` where each row is `[fullName, shortName, depth, amounts[]]`.

## Sidebar & Navigation

- UDashboardGroup with UDashboardSidebar (collapsible, resizable)
- Top: Dashboard, Budget, Reports links via UNavigationMenu
- Middle: "Accounts" label with gear icon linking to /accounts management page, UTree with account hierarchy
- Bottom: Settings link
- Account tree click navigates to `/accounts/{encodeURIComponent(fullName)}`
- Account tree built from flat account paths via `buildAccountTree` utility

## Pages

| Route | Purpose | Status |
|-------|---------|--------|
| `/` | Dashboard placeholder | Done (placeholder) |
| `/budget` | Budget placeholder | Done (placeholder) |
| `/reports` | Reports placeholder | Done (placeholder) |
| `/settings` | Journal management (create, upload, export, list, activate) | Done |
| `/accounts` | Account management (add/delete accounts) | Done |
| `/accounts/:path` | Account detail (transactions, balance, add/edit/delete) | Done |

## API Surface

| Method | Path | Purpose | Status |
|--------|------|---------|--------|
| GET | `/api/accounts` | List all account names (text mode) | Done |
| GET | `/api/balances` | Account balances with transforms | Done |
| GET | `/api/transactions` | List transactions with transforms | Done |
| POST | `/api/transactions` | Add a new transaction via hledger add | Done |
| DELETE | `/api/transactions?index=N` | Delete transaction by journal index | Done |
| POST | `/api/journal/create` | Create new empty journal file | Done |
| POST | `/api/journal/upload` | Upload journal file content | Done |
| GET | `/api/journal/export` | Export current journal as text | Done |
| POST | `/api/journal/activate` | Set LEDGER_FILE to specified journal | Done |
| GET | `/api/journal/list` | List available journals + active journal | Done |

## Known Issues & Lessons Learned

### hledger add stdin behavior
`hledger add` in interactive/stdin mode does NOT reject unbalanced transactions. Input validation for balanced amounts must happen in the app layer if needed.

### Windows CRLF in hledger output
On Windows, `hledger accounts` outputs lines with `\r\n`. The text parser must use `split(/\r?\n/)` and `.map(s => s.trim())` to avoid `\r` characters in account names (which caused `%0D` in URLs).

### hledger accounts doesn't support -O json
The `accounts` command only outputs plain text. Use `hledgerExecText` instead of `hledgerExec`.

### tsconfig must extend .nuxt/tsconfig.json
The root `tsconfig.json` must be `{ "extends": "./.nuxt/tsconfig.json" }` for `nuxi typecheck` to work. The Nuxt-generated tsconfig provides all auto-import types, path aliases, and `noUncheckedIndexedAccess`.

### UCard slots in Nuxt UI v4
UCard uses `header`, `default` (body content), and `footer` slots. There is no `#body` slot.

### UTree leaf nodes
Nodes with `children: []` are treated as expandable parents by UTree. Leaf nodes must have `children: undefined` (use `delete n.children`) so clicking them fires the `select` event instead of toggling expand.

## Deployment

### Docker Compose
- Single container: Node 20 Alpine with hledger installed via `apk`
- Multi-stage build: build Nuxt in stage 1, copy `.output/` + `test-data/` to runtime stage
- `LEDGER_FILE=test-data/sample.journal`, `HOST=0.0.0.0`, `PORT=3000`

### Local Development
- Requires hledger installed (`winget install simonmichael.hledger` on Windows)
- `npx nuxi dev` starts the dev server at http://localhost:3000
- `LEDGER_FILE` defaults to `test-data/sample.journal`

## Documentation References

- **Nuxt 4**: Use `mcp_nuxt_docs_*` MCP tools
- **Nuxt UI**: Use `mcp_nuxt_ui_*` MCP tools
- **hledger**: Web search + https://hledger.org

## Conventions

- Nuxt UI Dashboard components for layout (UDashboardGroup, UDashboardSidebar, UDashboardPanel)
- Nuxt UI components for all UI (UTable, UCard, UModal, UBadge, UTree, UFileUpload, etc.)
- Composables for data fetching in `composables/`
- Server routes in `server/api/`
- Shared types in `types/`
- hledger service logic in `server/utils/`
- Tests alongside source in `__tests__/` directories
- Property-based tests with fast-check, unit tests with vitest
- Mock Nitro globals with `vi.stubGlobal()` for API route tests
- Green theme (primary: green, neutral: zinc) with Public Sans font
