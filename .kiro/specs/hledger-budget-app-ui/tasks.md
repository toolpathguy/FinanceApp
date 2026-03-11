# Implementation Plan: hledger Budget App UI

## Overview

Build the base application shell and all sub-pages for the hledger budget app using Nuxt UI v4.5.1 Dashboard components. The implementation proceeds incrementally: project setup → types & utilities → composables → layout & pages → API routes → wiring & integration.

## Tasks

- [x] 1. Project setup and configuration
  - [x] 1.1 Upgrade `@nuxt/ui` to `4.5.1` in `package.json` and update `nuxt.config.ts` to add `css: ['~/assets/css/main.css']`
    - _Requirements: 1.6, 1.7_
  - [x] 1.2 Create `app.config.ts` with `ui.colors.primary: 'green'` and `ui.colors.neutral: 'zinc'`
    - _Requirements: 1.6_
  - [x] 1.3 Create `assets/css/main.css` with Tailwind static theme, `@nuxt/ui` import, Public Sans font, and custom green color palette
    - _Requirements: 1.7_
  - [x] 1.4 Update `app.vue` to render `UApp` wrapping `NuxtLoadingIndicator`, `NuxtLayout`, and `NuxtPage`, with `useHead` for theme-color meta
    - _Requirements: 1.5_
  - [x] 1.5 Change the default in `resolveJournalPath()` in `server/utils/hledger.ts` from `'/data/main.journal'` to `'test-data/sample.journal'`
    - _Requirements: 9.7_
  - [x] 1.6 Create `test-data/sample.journal` with realistic multi-month transactions across asset, liability, income, and expense accounts
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 2. Types and utility functions
  - [x] 2.1 Create `types/ui.ts` with `BudgetRow`, `BudgetReport`, `IncomeStatement`, `BalanceSheet`, `TransactionFormState`, and `AccountTreeItem` interfaces
    - _Requirements: 3.1, 5.1_
  - [x] 2.2 Implement `utils/buildAccountTree.ts` — converts flat colon-separated account paths into `AccountTreeItem[]` tree with implicit parents, sorted children, and `defaultExpanded` on top-level nodes
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 2.3 Write property test for `buildAccountTree` — Property 1: hierarchy preservation and implicit parents
    - **Property 1: Account tree preserves hierarchy and creates implicit parents**
    - **Validates: Requirements 3.1, 3.2**
  - [x] 2.4 Write property test for `buildAccountTree` — Property 2: children sorted alphabetically
    - **Property 2: Account tree children are sorted alphabetically**
    - **Validates: Requirement 3.3**
  - [x] 2.5 Write property test for `buildAccountTree` — Property 3: top-level nodes default-expanded
    - **Property 3: Account tree top-level nodes are default-expanded**
    - **Validates: Requirement 3.4**
  - [x] 2.6 Implement `utils/formatAmount.ts` — formats `{ commodity, quantity }` into strings like `"$1,234.56"` or `"-$42.00"`
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 2.7 Write property test for `formatAmount` — Property 4: amount formatting correctness
    - **Property 4: Amount formatting correctness**
    - **Validates: Requirements 4.1, 4.2**
  - [x] 2.8 Implement `utils/validateTransactionForm.ts` — validates `TransactionFormState` and returns error message array
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 2.9 Write property test for `validateTransactionForm` — Property 5: valid forms pass
    - **Property 5: Valid transaction forms pass validation**
    - **Validates: Requirement 5.1**
  - [x] 2.10 Write property test for `validateTransactionForm` — Property 6: invalid forms fail
    - **Property 6: Invalid transaction forms fail validation**
    - **Validates: Requirements 5.2, 5.4, 5.5**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Data fetching composables
  - [x] 4.1 Create `composables/useBalances.ts` — wraps `useFetch('/api/balances', ...)` with reactive query params, returns `{ data, status, error, refresh }`
    - _Requirements: 10.1, 10.7_
  - [x] 4.2 Create `composables/useTransactions.ts` — wraps `useFetch('/api/transactions', ...)` with reactive query params
    - _Requirements: 10.2, 10.7_
  - [x] 4.3 Create `composables/useAccounts.ts` — wraps `useFetch('/api/accounts')`
    - _Requirements: 10.3_
  - [x] 4.4 Create `composables/useBudget.ts` — wraps `useFetch('/api/budget', ...)` with optional period param
    - _Requirements: 10.4, 10.7_
  - [x] 4.5 Create `composables/useReports.ts` — exports `useIncomeStatement` and `useBalanceSheet` composables wrapping their respective API endpoints
    - _Requirements: 10.5, 10.6_

- [x] 5. Layout and sidebar
  - [x] 5.1 Create `layouts/default.vue` with `UDashboardGroup` (unit="rem"), `UDashboardSidebar` (collapsible, resizable, `bg-elevated/25`), header with app icon + title, `UNavigationMenu` for Dashboard/Budget/Reports, `USeparator`, "Accounts" label, `UTree` for account hierarchy (using `useAccounts` + `buildAccountTree`), Settings link at bottom, and `<slot />` for content
    - Account tree click handler navigates to `/accounts/{encodeURIComponent(item.fullName)}`
    - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 6. Pages
  - [x] 6.1 Create `pages/index.vue` — Dashboard placeholder with `UDashboardPanel`, `UDashboardNavbar` titled "Home", `UDashboardSidebarCollapse` in leading slot, `UCard` placeholder body
    - _Requirements: 11.1_
  - [x] 6.2 Create `pages/budget.vue` — Budget placeholder with same pattern, titled "Budget"
    - _Requirements: 11.2_
  - [x] 6.3 Create `pages/reports.vue` — Reports placeholder with same pattern, titled "Reports"
    - _Requirements: 11.3_
  - [x] 6.4 Create `pages/accounts/index.vue` — Accounts management page with `UDashboardPanel`, account list in `UTable`, add account form (`UInput` + "Add" button posting to `/api/transactions`), delete action per row
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 6.5 Create `pages/accounts/[...path].vue` — Account detail page with `UDashboardPanel`, decoded account name as navbar title, `UBadge` balance in `UDashboardToolbar`, `UTable` of transactions (date, description, postings summary, amount), "Add Transaction" button opening `UModal` with pre-filled form
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 6.6 Create `pages/settings.vue` — Settings page with `UDashboardPanel`, centered `UCard` (max-w-2xl) containing: Create journal section (`UInput`), Upload journal section (file input `.journal/.hledger/.j`), Export journal section (`UButton`), card footer with Save (primary) and Esc (neutral ghost, `router.back()`) buttons, sections separated by `USeparator`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 7. Journal API routes
  - [x] 7.1 Create `server/api/journal/create.post.ts` — accepts `{ filename }`, creates a new empty journal file
    - _Requirements: 9.1_
  - [x] 7.2 Create `server/api/journal/upload.post.ts` — accepts file content, saves as active journal
    - _Requirements: 9.2_
  - [x] 7.3 Create `server/api/journal/export.get.ts` — returns current journal file content, or error if file doesn't exist
    - _Requirements: 9.3, 9.4_
  - [x] 7.4 Create `server/api/journal/activate.post.ts` — accepts `{ filename }`, updates `LEDGER_FILE` env var
    - _Requirements: 9.5_

- [x] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Integration and wiring
  - [x] 9.1 Wire Settings page to journal API routes — connect Create/Upload/Export/Activate actions to their respective endpoints, add journal list and activate functionality
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.5, 9.6_
  - [x] 9.2 Wire Account detail page — connect `useTransactions` and `useBalances` composables, wire Add Transaction modal form submission to `POST /api/transactions`, use `formatAmount` for display
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 9.3 Wire Accounts management page — connect `useAccounts` composable, wire add/delete actions
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 9.4 Write property test for journal upload/export round-trip — Property 7
    - **Property 7: Journal upload/export round-trip**
    - **Validates: Requirements 9.2, 9.3**

- [x] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The design uses TypeScript throughout (Nuxt 4 / Vue 3)
- All composables use Nuxt's `useFetch` for SSR-compatible data fetching
- `fast-check` is already installed as a dev dependency for property-based tests
