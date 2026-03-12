# Design Document: hledger Budget App UI — Base Layout & Pages

## Overview

Build the base application shell and all sub-pages for the hledger budget app. Uses the Nuxt UI v4.5.1 Dashboard component system (`UDashboardGroup`, `UDashboardSidebar`, `UDashboardPanel`, `UDashboardNavbar`, `UDashboardToolbar`) for the visual foundation — matching the official [nuxt-ui-templates/dashboard](https://github.com/nuxt-ui-templates/dashboard) styling. The sidebar contains an account tree (`UTree`) that loads sub-page content on the right. Clicking an account shows that account's transactions in the content area.

## Scope

- Upgrade `@nuxt/ui` to `4.5.1`
- Visual styling matches the official Nuxt UI Dashboard template:
  - `app.config.ts` with `primary`/`neutral` color config
  - `assets/css/main.css` with Tailwind theme, `@nuxt/ui` import, custom font
  - `NuxtLoadingIndicator` in app.vue
  - `UDashboardGroup` (unit="rem") wrapping `UDashboardSidebar` + `UDashboardPanel`
  - Sidebar uses `class="bg-elevated/25"`, collapsible, resizable
  - Pages use `UDashboardPanel` with `#header` (UDashboardNavbar + optional UDashboardToolbar) and `#body` slots
  - `UDashboardSidebarCollapse` in navbar leading slot
- Sidebar navigation: top section has Dashboard/Budget/Reports links via `UNavigationMenu`, middle section has `UTree` showing the hledger account hierarchy, bottom has Settings button
- Clicking an account in the tree renders that account's transactions + balance in the content area
- No standalone Transactions page — transactions are shown per-account
- Top-level accounts page (`/accounts`) for managing accounts (add/delete)
- Settings page as a UCard with Save and Esc buttons for journal file management (Create/Upload/Export)
- Dashboard, Budget, Reports pages are placeholders for now
- Account detail pages are fully functional
- Test data journal file for UI development
- All table data displayed in the right content area via `UDashboardPanel #body`
- Data fetching composables wrapping existing `/api/*` routes

## Core Interfaces/Types

```typescript
// types/ui.ts — UI-specific types

/** Budget line item: account with budgeted vs actual amounts */
export interface BudgetRow {
  account: string
  budgeted: number
  actual: number
  remaining: number
  /** 0–100 percentage spent */
  percentUsed: number
}

/** Budget report returned by GET /api/budget */
export interface BudgetReport {
  rows: BudgetRow[]
  period: string
}

/** Income statement sections */
export interface IncomeStatement {
  revenues: { account: string; amounts: { commodity: string; quantity: number }[] }[]
  expenses: { account: string; amounts: { commodity: string; quantity: number }[] }[]
  net: { commodity: string; quantity: number }[]
}

/** Balance sheet sections */
export interface BalanceSheet {
  assets: { account: string; amounts: { commodity: string; quantity: number }[] }[]
  liabilities: { account: string; amounts: { commodity: string; quantity: number }[] }[]
  equity: { account: string; amounts: { commodity: string; quantity: number }[] }[]
  net: { commodity: string; quantity: number }[]
}

/** Shape of the add-transaction form state */
export interface TransactionFormState {
  date: string
  description: string
  postings: { account: string; amount: string; commodity: string }[]
  status: '' | '!' | '*'
}

/** Account tree node for UTree items */
export interface AccountTreeItem {
  label: string
  fullName: string
  icon?: string
  children?: AccountTreeItem[]
  defaultExpanded?: boolean
}
```

## Key Functions with Formal Specifications

### Composable: useBalances()

```typescript
function useBalances(query?: MaybeRefOrGetter<BalanceQuery>): {
  data: Ref<HledgerBalanceReport | null>
  status: Ref<'idle' | 'pending' | 'success' | 'error'>
  error: Ref<Error | null>
  refresh: () => Promise<void>
}
```

**Preconditions:**
- `query.depth` if provided is a positive integer
- `query.period` if provided is a valid hledger period string

**Postconditions:**
- On success, `data.value.rows` is an array of `HledgerBalanceRow`
- Reactively re-fetches when `query` ref changes

### Composable: useTransactions()

```typescript
function useTransactions(query?: MaybeRefOrGetter<TransactionQuery>): {
  data: Ref<HledgerTransaction[] | null>
  status: Ref<'idle' | 'pending' | 'success' | 'error'>
  error: Ref<Error | null>
  refresh: () => Promise<void>
}
```

**Preconditions:**
- `query.startDate` and `query.endDate` if provided are `YYYY-MM-DD` strings

**Postconditions:**
- `data.value` is an array of `HledgerTransaction` sorted by date (as returned by hledger)
- Reactively re-fetches when `query` ref changes

### Composable: useAccounts()

```typescript
function useAccounts(): {
  data: Ref<string[] | null>
  status: Ref<'idle' | 'pending' | 'success' | 'error'>
  error: Ref<Error | null>
  refresh: () => Promise<void>
}
```

**Postconditions:**
- `data.value` is a flat array of account name strings (e.g., `["assets:checking", "expenses:food"]`)

### Composable: useBudget()

```typescript
function useBudget(period?: MaybeRefOrGetter<string>): {
  data: Ref<BudgetReport | null>
  status: Ref<'idle' | 'pending' | 'success' | 'error'>
  error: Ref<Error | null>
  refresh: () => Promise<void>
}
```

**Postconditions:**
- `data.value.rows[i].percentUsed` equals `Math.round((actual / budgeted) * 100)` clamped to 0–100
- `data.value.rows[i].remaining` equals `budgeted - actual`

### Composable: useIncomeStatement() / useBalanceSheet()

```typescript
function useIncomeStatement(period?: MaybeRefOrGetter<string>): {
  data: Ref<IncomeStatement | null>
  status: Ref<'idle' | 'pending' | 'success' | 'error'>
  error: Ref<Error | null>
  refresh: () => Promise<void>
}

function useBalanceSheet(): {
  data: Ref<BalanceSheet | null>
  status: Ref<'idle' | 'pending' | 'success' | 'error'>
  error: Ref<Error | null>
  refresh: () => Promise<void>
}
```

### Utility: buildAccountTree()

```typescript
function buildAccountTree(accounts: string[]): AccountTreeItem[]
```

**Preconditions:**
- `accounts` is an array of colon-separated account paths (e.g., `"assets:checking"`)

**Postconditions:**
- Returns a forest of `AccountTreeItem` compatible with Nuxt UI `UTree` items prop
- Each node has `label` (short name), `fullName` (colon-separated path), and optional `children`
- Parent nodes are created implicitly (e.g., `"assets"` is created as parent of `"assets:checking"`)
- `children` arrays are sorted alphabetically by `label`
- Top-level nodes have `defaultExpanded: true`

**Loop Invariant:**
- At each iteration, all previously inserted accounts have correct parent-child relationships

### Utility: formatAmount()

```typescript
function formatAmount(amount: { commodity: string; quantity: number }): string
```

**Postconditions:**
- Returns formatted string like `"$1,234.56"` or `"-$42.00"`
- Negative quantities are prefixed with `-` before the commodity symbol
- Quantities are formatted with 2 decimal places and thousands separators

### Utility: validateTransactionForm()

```typescript
function validateTransactionForm(state: TransactionFormState): string[]
```

**Postconditions:**
- Returns empty array if form is valid
- Checks: date is non-empty and matches `YYYY-MM-DD`, description is non-empty, at least 2 postings, each posting has a non-empty account

## Algorithmic Pseudocode

### buildAccountTree Algorithm

```typescript
function buildAccountTree(accounts: string[]): AccountTreeItem[] {
  const roots: AccountTreeItem[] = []
  const nodeMap = new Map<string, AccountTreeItem>()
  const sorted = [...accounts].sort()

  for (const fullName of sorted) {
    // INVARIANT: all ancestors of previously processed accounts exist in nodeMap
    const parts = fullName.split(':')
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      const parentPath = currentPath
      currentPath = currentPath ? `${currentPath}:${parts[i]}` : parts[i]

      if (!nodeMap.has(currentPath)) {
        const node: AccountTreeItem = {
          label: parts[i],
          fullName: currentPath,
          children: [],
        }
        nodeMap.set(currentPath, node)

        if (parentPath && nodeMap.has(parentPath)) {
          nodeMap.get(parentPath)!.children!.push(node)
        } else if (!parentPath) {
          node.defaultExpanded = true
          roots.push(node)
        }
      }
    }
  }

  const sortChildren = (nodes: AccountTreeItem[]) => {
    nodes.sort((a, b) => a.label.localeCompare(b.label))
    nodes.forEach((n) => {
      if (n.children?.length) sortChildren(n.children)
    })
  }
  sortChildren(roots)
  return roots
}
```

### Sidebar Account Selection Flow

```typescript
// When user clicks an account in the UTree:
// 1. UTree emits select event with the selected AccountTreeItem
// 2. Handler navigates to /accounts/:accountPath (encoded)
// 3. Account page fetches transactions + balance for that account
// 4. Content area renders UTable with account transactions

function onAccountSelect(e: any, item: AccountTreeItem) {
  navigateTo(`/accounts/${encodeURIComponent(item.fullName)}`)
}
```

## Visual Styling — Dashboard Template Pattern

The app follows the exact visual patterns from the official Nuxt UI Dashboard template:

### `app.config.ts`
```typescript
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      neutral: 'zinc'
    }
  }
})
```

### `assets/css/main.css`
```css
@import "tailwindcss" theme(static);
@import "@nuxt/ui";

@theme static {
  --font-sans: 'Public Sans', sans-serif;

  --color-green-50: #EFFDF5;
  --color-green-100: #D9FBE8;
  --color-green-200: #B3F5D1;
  --color-green-300: #75EDAE;
  --color-green-400: #00DC82;
  --color-green-500: #00C16A;
  --color-green-600: #00A155;
  --color-green-700: #007F45;
  --color-green-800: #016538;
  --color-green-900: #0A5331;
  --color-green-950: #052E16;
}
```

### `nuxt.config.ts` additions
```typescript
css: ['~/assets/css/main.css']
```

### `app.vue` pattern
```vue
<template>
  <UApp>
    <NuxtLoadingIndicator />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
```

### Layout pattern — `layouts/default.vue`
```vue
<!-- Uses UDashboardGroup + UDashboardSidebar, NOT standalone USidebar -->
<UDashboardGroup unit="rem">
  <UDashboardSidebar
    id="default"
    v-model:open="open"
    collapsible
    resizable
    class="bg-elevated/25"
    :ui="{ footer: 'lg:border-t lg:border-default' }"
  >
    <!-- header, default, footer slots -->
  </UDashboardSidebar>

  <slot />
</UDashboardGroup>
```

### Page pattern — every page uses `UDashboardPanel`
```vue
<UDashboardPanel id="page-name">
  <template #header>
    <UDashboardNavbar title="Page Title">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <!-- optional #right slot for actions -->
    </UDashboardNavbar>
    <!-- optional UDashboardToolbar -->
  </template>

  <template #body>
    <!-- page content here -->
  </template>
</UDashboardPanel>
```

## Component Specifications

### Base Layout — `layouts/default.vue`

```typescript
// UDashboardGroup + UDashboardSidebar (matching dashboard template)
//
// Sidebar structure:
//   Header: app logo (i-lucide-wallet) + title "hledger Budget"
//   Default slot (body):
//     - UNavigationMenu (vertical, collapsed-aware, tooltip, popover) with Dashboard, Budget, Reports links
//     - USeparator
//     - "Accounts" label (hidden when collapsed)
//     - UTree with account hierarchy from useAccounts() → buildAccountTree()
//       - Clicking a tree node navigates to /accounts/:accountPath
//       - get-key returns item.fullName for unique identification
//     - Settings UNavigationMenu at bottom (mt-auto) with Settings link
//   Footer: color mode toggle or user info area
// Content area: <slot /> renders page's UDashboardPanel

const links = [[
  { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: 'Budget', icon: 'i-lucide-target', to: '/budget' },
  { label: 'Reports', icon: 'i-lucide-bar-chart-3', to: '/reports' },
]] satisfies NavigationMenuItem[][]

const settingsLinks = [[
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
]] satisfies NavigationMenuItem[][]
```

**Nuxt UI components used:** `UDashboardGroup`, `UDashboardSidebar`, `UNavigationMenu`, `UTree`, `UIcon`, `USeparator`, `UDashboardSidebarCollapse`

### app.vue

```typescript
// Matches dashboard template: UApp + NuxtLoadingIndicator + NuxtLayout + NuxtPage
// Also sets useHead with theme-color meta (dark: '#1b1718', light: 'white')
// Sets basic SEO meta
```

### DashboardPage — `pages/index.vue` (PLACEHOLDER)

```typescript
// UDashboardPanel with UDashboardNavbar title="Home"
// Leading slot: UDashboardSidebarCollapse
// Body: placeholder UCard with "Dashboard coming soon" message
// Will be implemented later with balance overview + recent transactions
```

**Nuxt UI components used:** `UDashboardPanel`, `UDashboardNavbar`, `UDashboardSidebarCollapse`, `UCard`

### AccountsManagementPage — `pages/accounts/index.vue`

```typescript
// UDashboardPanel with UDashboardNavbar title="Accounts"
// Leading slot: UDashboardSidebarCollapse
// Right slot: "Add Account" UButton
//
// Body content:
//   - Add account form: UInput for account name (colon-separated path) + UButton "Add"
//     Adds account by creating a zero-balance opening transaction via POST /api/transactions
//   - Account list: UTable showing all accounts with delete action per row
//
// Data: useAccounts()
```

**Nuxt UI components used:** `UDashboardPanel`, `UDashboardNavbar`, `UDashboardSidebarCollapse`, `UTable`, `UButton`, `UInput`, `UFormField`, `UModal`

### AccountDetailPage — `pages/accounts/[...path].vue`

```typescript
// UDashboardPanel with UDashboardNavbar showing account name as title
// Leading slot: UDashboardSidebarCollapse
// Right slot: "Add Transaction" UButton
//
// Optional UDashboardToolbar: shows current balance as UBadge
//
// Body content:
//   - UTable: all transactions for this account (newest first)
//     Columns: date, description, postings summary, amount
//   - "Add Transaction" opens UModal with pre-filled account
//
// Route param: path (catch-all, e.g., "assets:checking")
// Data: useTransactions({ account }), useBalances({ account })

interface AccountPageState {
  account: string  // from route param, decoded
  showAddForm: boolean
}
```

**Nuxt UI components used:** `UDashboardPanel`, `UDashboardNavbar`, `UDashboardToolbar`, `UDashboardSidebarCollapse`, `UTable`, `UButton`, `UModal`, `UInput`, `UFormField`, `UBadge`

### BudgetPage — `pages/budget.vue` (PLACEHOLDER)

```typescript
// UDashboardPanel with UDashboardNavbar title="Budget"
// Leading slot: UDashboardSidebarCollapse
// Body: placeholder UCard with "Budget tracking coming soon" message
```

**Nuxt UI components used:** `UDashboardPanel`, `UDashboardNavbar`, `UDashboardSidebarCollapse`, `UCard`

### ReportsPage — `pages/reports.vue` (PLACEHOLDER)

```typescript
// UDashboardPanel with UDashboardNavbar title="Reports"
// Leading slot: UDashboardSidebarCollapse
// Body: placeholder UCard with "Reports coming soon" message
```

**Nuxt UI components used:** `UDashboardPanel`, `UDashboardNavbar`, `UDashboardSidebarCollapse`, `UCard`

### SettingsPage — `pages/settings.vue`

```typescript
// UDashboardPanel with UDashboardNavbar title="Settings"
// Leading slot: UDashboardSidebarCollapse
//
// Body content (centered, max-w-2xl like dashboard template settings):
//   Single UCard with journal file management
//   Card body contains three sections separated by USeparator:
//     1. Create new journal — UInput for filename + description text
//     2. Upload journal — file input (accept=".journal,.hledger,.j") + description text
//     3. Export journal — UButton "Export" + description text
//   Card footer: "Save" UButton (primary) + "Esc" UButton (neutral ghost, router.back())
```

**Nuxt UI components used:** `UDashboardPanel`, `UDashboardNavbar`, `UDashboardSidebarCollapse`, `UCard`, `UButton`, `UInput`, `UFormField`, `USeparator`

**New API routes needed:**
- `POST /api/journal/create` — create a new empty journal file
- `POST /api/journal/upload` — upload journal file content
- `GET /api/journal/export` — download current journal file content
- `POST /api/journal/activate` — set `LEDGER_FILE` env var to the specified journal file path

## Test Data Journal

A sample hledger journal file (`test-data/sample.journal`) for UI development and testing. Contains realistic transactions across multiple account types to exercise all UI features:

```
; Sample hledger journal for UI testing
; Covers: assets, liabilities, income, expenses across multiple months

account assets:checking
account assets:savings
account liabilities:credit-card
account income:salary
account income:freelance
account expenses:food:groceries
account expenses:food:restaurants
account expenses:housing:rent
account expenses:housing:utilities
account expenses:transport
account expenses:entertainment

2025-01-01 * Opening balances
    assets:checking                    $5,000.00
    assets:savings                    $10,000.00
    equity:opening-balances

2025-01-05 * Salary
    assets:checking                    $3,500.00
    income:salary

2025-01-07 * Grocery store
    expenses:food:groceries              $85.50
    assets:checking

2025-01-10 * Rent
    expenses:housing:rent             $1,200.00
    assets:checking

2025-01-12 * Electric bill
    expenses:housing:utilities           $95.00
    assets:checking

2025-01-15 * Restaurant dinner
    expenses:food:restaurants            $45.00
    liabilities:credit-card

2025-01-18 * Freelance payment
    assets:checking                      $500.00
    income:freelance

2025-01-20 * Gas station
    expenses:transport                   $55.00
    assets:checking

2025-01-22 * Movie tickets
    expenses:entertainment               $30.00
    liabilities:credit-card

2025-01-25 * Transfer to savings
    assets:savings                      $500.00
    assets:checking

2025-02-01 * Salary
    assets:checking                    $3,500.00
    income:salary

2025-02-03 * Grocery store
    expenses:food:groceries              $92.00
    assets:checking

2025-02-05 * Credit card payment
    liabilities:credit-card              $75.00
    assets:checking

2025-02-10 * Rent
    expenses:housing:rent             $1,200.00
    assets:checking

2025-02-14 * Valentine's dinner
    expenses:food:restaurants            $120.00
    liabilities:credit-card

2025-02-20 * Internet bill
    expenses:housing:utilities           $65.00
    assets:checking
```

This journal provides:
- Multiple account hierarchy levels (expenses:food:groceries)
- Both asset and liability accounts
- Income from multiple sources
- Transactions spanning multiple months
- Mix of cleared (*) transactions
- Realistic dollar amounts

## File Structure

```
├── app.vue                          # UApp + NuxtLoadingIndicator + NuxtLayout
├── app.config.ts                    # UI colors (primary: green, neutral: zinc)
├── assets/
│   └── css/
│       └── main.css                 # Tailwind theme, @nuxt/ui import, Public Sans font
├── layouts/
│   └── default.vue                  # UDashboardGroup + UDashboardSidebar + slot
├── pages/
│   ├── index.vue                    # Dashboard (placeholder, UDashboardPanel)
│   ├── accounts/
│   │   ├── index.vue                # Account management (add/delete)
│   │   └── [...path].vue            # Account detail (transactions + balance)
│   ├── budget.vue                   # Budget (placeholder)
│   ├── reports.vue                  # Reports (placeholder)
│   └── settings.vue                 # Journal file management (UCard + Save/Esc)
├── composables/
│   ├── useBalances.ts
│   ├── useTransactions.ts
│   ├── useAccounts.ts
│   ├── useBudget.ts
│   └── useReports.ts
├── utils/
│   ├── buildAccountTree.ts
│   ├── formatAmount.ts
│   └── validateTransactionForm.ts
├── types/
│   └── ui.ts                        # UI-specific types (AccountTreeItem, etc.)
├── test-data/
│   └── sample.journal               # Test journal for UI development
└── server/api/journal/
    ├── create.post.ts               # POST /api/journal/create
    ├── upload.post.ts               # POST /api/journal/upload
    └── export.get.ts                # GET /api/journal/export
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Account tree preserves hierarchy and creates implicit parents

*For any* set of colon-separated account paths, `buildAccountTree` shall produce a tree where every account path in the input has a corresponding node, all intermediate ancestor nodes are created even if not in the input, and each node's `fullName` equals the colon-joined path from root to that node.

**Validates: Requirements 3.1, 3.2**

### Property 2: Account tree children are sorted alphabetically

*For any* set of colon-separated account paths, at every level of the tree returned by `buildAccountTree`, the `children` array is sorted alphabetically by `label`.

**Validates: Requirement 3.3**

### Property 3: Account tree top-level nodes are default-expanded

*For any* set of colon-separated account paths, every top-level node in the tree returned by `buildAccountTree` has `defaultExpanded` set to `true`.

**Validates: Requirement 3.4**

### Property 4: Amount formatting correctness

*For any* `{ commodity, quantity }` object, `formatAmount` returns a string that contains the commodity symbol, formats the absolute quantity with exactly 2 decimal places and thousands separators, and prefixes with `-` if and only if the quantity is negative.

**Validates: Requirements 4.1, 4.2**

### Property 5: Valid transaction forms pass validation

*For any* `TransactionFormState` with a date matching `YYYY-MM-DD`, a non-empty description, and at least 2 postings each with a non-empty account, `validateTransactionForm` returns an empty array.

**Validates: Requirement 5.1**

### Property 6: Invalid transaction forms fail validation

*For any* `TransactionFormState` that violates at least one rule (invalid date format, empty description, fewer than 2 postings, or any posting with an empty account), `validateTransactionForm` returns a non-empty array of error messages.

**Validates: Requirements 5.2, 5.4, 5.5**

### Property 7: Journal upload/export round-trip

*For any* valid journal file content, uploading it via `POST /api/journal/upload` and then exporting via `GET /api/journal/export` shall return content identical to the original upload.

**Validates: Requirements 9.2, 9.3**
