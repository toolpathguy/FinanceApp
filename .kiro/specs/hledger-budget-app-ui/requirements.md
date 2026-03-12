# Requirements Document

## Introduction

This document defines the requirements for the hledger Budget App UI feature. The feature builds the base application shell and all sub-pages using the Nuxt UI v4.5.1 Dashboard component system, providing a sidebar-driven layout with account tree navigation, journal file management, and data-fetching composables wrapping existing API routes.

## Glossary

- **App_Shell**: The root application layout comprising `UDashboardGroup`, `UDashboardSidebar`, and `UDashboardPanel` components that form the visual foundation of the application
- **Sidebar**: The left-hand navigation panel rendered by `UDashboardSidebar`, containing navigation links, the account tree, and a settings link
- **Account_Tree**: A hierarchical tree view rendered by `UTree` showing hledger accounts in parent-child relationships derived from colon-separated account paths
- **Content_Area**: The right-hand panel rendered by `UDashboardPanel` where page content is displayed
- **Account_Detail_Page**: The page at `/accounts/:accountPath` that displays transactions and balance for a specific account
- **Accounts_Management_Page**: The page at `/accounts` for adding and deleting accounts
- **Settings_Page**: The page at `/settings` for journal file management (create, upload, export)
- **Dashboard_Page**: The placeholder page at `/` for future balance overview and recent transactions
- **Budget_Page**: The placeholder page at `/budget` for future budget tracking
- **Reports_Page**: The placeholder page at `/reports` for future financial reports
- **Composable**: A Vue composable function that wraps API calls and provides reactive data, status, error, and refresh capabilities
- **buildAccountTree**: A utility function that converts a flat array of colon-separated account paths into a hierarchical tree structure compatible with `UTree`
- **formatAmount**: A utility function that formats an `{ commodity, quantity }` object into a human-readable currency string
- **validateTransactionForm**: A utility function that validates a transaction form state and returns an array of error messages
- **Journal_API**: The set of server API routes under `/api/journal/` for creating, uploading, and exporting journal files
- **Navigation_Menu**: The `UNavigationMenu` component in the sidebar providing links to Dashboard, Budget, and Reports pages

## Requirements

### Requirement 1: Application Shell and Layout

**User Story:** As a user, I want a dashboard-style application layout with a collapsible sidebar and content area, so that I can navigate the app efficiently.

#### Acceptance Criteria

1. THE App_Shell SHALL render a `UDashboardGroup` with `unit="rem"` wrapping a `UDashboardSidebar` and a content slot
2. THE Sidebar SHALL be collapsible and resizable with `class="bg-elevated/25"`
3. WHEN a page is rendered, THE Content_Area SHALL display a `UDashboardPanel` with a `#header` slot containing `UDashboardNavbar` and a `#body` slot for page content
4. THE `UDashboardNavbar` SHALL include a `UDashboardSidebarCollapse` component in its leading slot on every page
5. THE `app.vue` SHALL render `UApp` wrapping `NuxtLoadingIndicator`, `NuxtLayout`, and `NuxtPage`
6. THE `app.config.ts` SHALL configure `ui.colors.primary` as `"green"` and `ui.colors.neutral` as `"zinc"`
7. THE `assets/css/main.css` SHALL import Tailwind CSS with a static theme, import `@nuxt/ui`, set the sans font to `Public Sans`, and define a custom green color palette

### Requirement 2: Sidebar Navigation

**User Story:** As a user, I want a sidebar with navigation links and an account tree, so that I can quickly access all sections of the app and drill into specific accounts.

#### Acceptance Criteria

1. THE Sidebar SHALL display a Navigation_Menu with links to Dashboard (`/`), Budget (`/budget`), and Reports (`/reports`) in its top section
2. THE Sidebar SHALL display the Account_Tree in its middle section, populated from account data fetched via the `useAccounts` Composable
3. WHEN a user clicks an account node in the Account_Tree, THE App_Shell SHALL navigate to `/accounts/{encodedAccountPath}` where `encodedAccountPath` is the URI-encoded full account name
4. THE Sidebar SHALL display a Settings navigation link at the bottom of its body, linking to `/settings`
5. THE Sidebar header SHALL display an app icon (`i-lucide-wallet`) and the title "hledger Budget"

### Requirement 3: Account Tree Construction

**User Story:** As a user, I want the account hierarchy displayed as a tree, so that I can see the parent-child relationships between accounts.

#### Acceptance Criteria

1. WHEN a flat array of colon-separated account paths is provided, THE buildAccountTree function SHALL return a forest of `AccountTreeItem` nodes with correct parent-child nesting
2. THE buildAccountTree function SHALL create implicit parent nodes for intermediate path segments that are not explicitly listed in the input array
3. THE buildAccountTree function SHALL sort children arrays alphabetically by label at every level of the tree
4. THE buildAccountTree function SHALL set `defaultExpanded` to `true` on all top-level nodes
5. WHEN an empty array is provided, THE buildAccountTree function SHALL return an empty array

### Requirement 4: Amount Formatting

**User Story:** As a user, I want monetary amounts displayed in a consistent, readable format, so that I can quickly understand financial figures.

#### Acceptance Criteria

1. WHEN a positive quantity is provided, THE formatAmount function SHALL return a string with the commodity symbol followed by the quantity formatted with 2 decimal places and thousands separators (e.g., `"$1,234.56"`)
2. WHEN a negative quantity is provided, THE formatAmount function SHALL return a string with a `-` prefix before the commodity symbol (e.g., `"-$42.00"`)
3. WHEN a zero quantity is provided, THE formatAmount function SHALL return the commodity symbol followed by `"0.00"` (e.g., `"$0.00"`)

### Requirement 5: Transaction Form Validation

**User Story:** As a user, I want the transaction form to validate my input before submission, so that I can avoid submitting incomplete or malformed transactions.

#### Acceptance Criteria

1. WHEN the form state has a valid date (matching `YYYY-MM-DD`), a non-empty description, at least 2 postings each with a non-empty account, THE validateTransactionForm function SHALL return an empty array
2. WHEN the date field is empty or does not match the `YYYY-MM-DD` format, THE validateTransactionForm function SHALL return an array containing a date validation error message
3. WHEN the description field is empty, THE validateTransactionForm function SHALL return an array containing a description validation error message
4. WHEN fewer than 2 postings are provided, THE validateTransactionForm function SHALL return an array containing a postings count error message
5. WHEN any posting has an empty account field, THE validateTransactionForm function SHALL return an array containing a posting account error message

### Requirement 6: Account Detail Page

**User Story:** As a user, I want to view all transactions and the current balance for a specific account, so that I can review my financial activity per account.

#### Acceptance Criteria

1. WHEN a user navigates to `/accounts/:path`, THE Account_Detail_Page SHALL display the decoded account name as the page title in the `UDashboardNavbar`
2. THE Account_Detail_Page SHALL display the current account balance as a `UBadge` in a `UDashboardToolbar`
3. THE Account_Detail_Page SHALL display all transactions for the account in a `UTable` with columns for date, description, postings summary, and amount
4. WHEN the user clicks the "Add Transaction" button, THE Account_Detail_Page SHALL open a `UModal` with a transaction form pre-filled with the current account
5. THE Account_Detail_Page SHALL fetch transaction and balance data using the `useTransactions` and `useBalances` Composables with the account path as a query parameter

### Requirement 7: Accounts Management Page

**User Story:** As a user, I want to manage my accounts by adding new ones or deleting existing ones, so that I can keep my chart of accounts up to date.

#### Acceptance Criteria

1. THE Accounts_Management_Page SHALL display a list of all accounts in a `UTable`
2. THE Accounts_Management_Page SHALL provide an input field for entering a new account name (colon-separated path) and an "Add" button
3. WHEN a user submits a new account name, THE Accounts_Management_Page SHALL create a zero-balance opening transaction via `POST /api/transactions`
4. THE Accounts_Management_Page SHALL provide a delete action per account row

### Requirement 8: Settings Page — Journal File Management

**User Story:** As a user, I want to create, upload, and export journal files from a settings page, so that I can manage my financial data files.

#### Acceptance Criteria

1. THE Settings_Page SHALL render a single `UCard` centered with `max-w-2xl` containing three sections separated by `USeparator` components
2. THE Settings_Page SHALL provide a "Create new journal" section with a `UInput` for the filename
3. THE Settings_Page SHALL provide an "Upload journal" section with a file input accepting `.journal`, `.hledger`, and `.j` file extensions
4. THE Settings_Page SHALL provide an "Export journal" section with an "Export" button
5. THE Settings_Page SHALL display a "Save" button (primary variant) and an "Esc" button (neutral ghost variant) in the card footer
6. WHEN the "Esc" button is clicked, THE Settings_Page SHALL navigate back to the previous page

### Requirement 9: Journal File API Routes

**User Story:** As a user, I want server endpoints for creating, uploading, and exporting journal files, so that the settings page can manage journal data.

#### Acceptance Criteria

1. WHEN a `POST` request is sent to `/api/journal/create` with a filename, THE Journal_API SHALL create a new empty journal file with that name
2. WHEN a `POST` request is sent to `/api/journal/upload` with file content, THE Journal_API SHALL save the uploaded content as the active journal file
3. WHEN a `GET` request is sent to `/api/journal/export`, THE Journal_API SHALL return the current journal file content for download
4. IF the journal file does not exist when an export is requested, THEN THE Journal_API SHALL return an appropriate error response
5. WHEN a `POST` request is sent to `/api/journal/activate` with a journal filename, THE Journal_API SHALL update the `LEDGER_FILE` environment variable to point to the specified journal file path
6. THE Settings_Page SHALL provide a way to select and activate a specific journal file from the available journals
7. WHEN no `LEDGER_FILE` environment variable is set, THE application SHALL default to using the test data journal at `test-data/sample.journal`

### Requirement 10: Data Fetching Composables

**User Story:** As a developer, I want reactive composables that wrap API calls, so that pages can fetch and display data with consistent loading and error states.

#### Acceptance Criteria

1. THE `useBalances` Composable SHALL return reactive `data`, `status`, `error`, and `refresh` properties by calling `GET /api/balances` with optional query parameters
2. THE `useTransactions` Composable SHALL return reactive `data`, `status`, `error`, and `refresh` properties by calling `GET /api/transactions` with optional query parameters
3. THE `useAccounts` Composable SHALL return reactive `data`, `status`, `error`, and `refresh` properties by calling `GET /api/accounts`
4. THE `useBudget` Composable SHALL return reactive `data`, `status`, `error`, and `refresh` properties by calling `GET /api/budget` with an optional period parameter
5. THE `useIncomeStatement` Composable SHALL return reactive `data`, `status`, `error`, and `refresh` properties for income statement data
6. THE `useBalanceSheet` Composable SHALL return reactive `data`, `status`, `error`, and `refresh` properties for balance sheet data
7. WHEN query parameters change on a Composable, THE Composable SHALL reactively re-fetch data from the corresponding API endpoint

### Requirement 11: Placeholder Pages

**User Story:** As a user, I want placeholder pages for Dashboard, Budget, and Reports, so that the navigation structure is complete and ready for future implementation.

#### Acceptance Criteria

1. THE Dashboard_Page SHALL render a `UDashboardPanel` with a `UDashboardNavbar` titled "Home" and a `UCard` placeholder in the body
2. THE Budget_Page SHALL render a `UDashboardPanel` with a `UDashboardNavbar` titled "Budget" and a `UCard` placeholder in the body
3. THE Reports_Page SHALL render a `UDashboardPanel` with a `UDashboardNavbar` titled "Reports" and a `UCard` placeholder in the body

### Requirement 12: Test Data

**User Story:** As a developer, I want a sample journal file with realistic transactions, so that I can develop and test the UI against representative data.

#### Acceptance Criteria

1. THE test data journal file SHALL be located at `test-data/sample.journal`
2. THE test data journal file SHALL contain account declarations spanning multiple hierarchy levels (e.g., `expenses:food:groceries`)
3. THE test data journal file SHALL contain transactions across at least two calendar months
4. THE test data journal file SHALL include asset, liability, income, and expense account types
