# Requirements Document

## Introduction

This document defines the requirements for implementing YNAB-style envelope budgeting using hledger sub-accounts. Budget envelopes are represented as real hledger sub-accounts under `assets:checking:budget:*`, making every budget assignment a proper double-entry transaction. A direct journal writer replaces the current `hledger add` stdin-piping approach to support multi-posting transactions, balance assertions, and deterministic formatting.

## Glossary

- **Envelope**: A budget sub-account under `assets:checking:budget:*` representing a spending category
- **Physical_Account**: A real bank account (e.g., `assets:checking`) whose ledger balance should be $0 when all money is assigned to envelopes
- **Budget_Sub_Account**: An hledger account under `assets:<account>:budget:<category>` that holds assigned funds
- **Unallocated_Account**: The special envelope `assets:checking:budget:unallocated` holding money not yet assigned to a category
- **Budget_Assignment_Transaction**: An hledger transaction that moves money from a physical account into one or more budget sub-accounts
- **Balance_Assertion**: An hledger posting annotation (`= $0.00`) that asserts the account balance after the posting
- **Journal_Writer**: The module that validates, formats, and appends transactions directly to the hledger journal file
- **Transaction_Input**: A data structure containing date, description, status, and postings for a single hledger transaction
- **Posting**: A single line in an hledger transaction specifying an account and optional amount
- **App**: The Nuxt-based budgeting application (server + UI)
- **Budget_Page**: The UI page displaying envelope balances, assignments, and activity
- **Sidebar**: The navigation component showing real financial accounts

## Requirements

### Requirement 1: Direct Journal Writer — Transaction Formatting

**User Story:** As a developer, I want to format transactions into valid hledger journal syntax, so that the app can write directly to journal files without spawning `hledger add`.

#### Acceptance Criteria

1. WHEN a valid Transaction_Input is provided, THE Journal_Writer SHALL produce a string in valid hledger journal syntax with date, optional status marker, description on the first line, and 4-space-indented postings on subsequent lines
2. WHEN a Transaction_Input contains a Posting with a Balance_Assertion, THE Journal_Writer SHALL include the assertion syntax (`= <amount>`) in the formatted output
3. WHEN formatting amounts, THE Journal_Writer SHALL output the commodity symbol followed by the number with exactly 2 decimal places (e.g., `$5.00`, `$-5.00`)
4. THE Journal_Writer SHALL prepend a newline separator before each formatted transaction and end with a newline after the last posting
5. WHEN a Transaction_Input contains a Posting with no explicit amount, THE Journal_Writer SHALL omit the amount field for that posting, allowing hledger to infer it

### Requirement 2: Direct Journal Writer — Transaction Validation

**User Story:** As a developer, I want to validate transactions before writing them, so that the journal file always contains well-formed, balanced entries.

#### Acceptance Criteria

1. WHEN a Transaction_Input has an invalid date (not YYYY-MM-DD format), THE Journal_Writer SHALL return a validation error describing the issue
2. WHEN a Transaction_Input has an empty description, THE Journal_Writer SHALL return a validation error describing the issue
3. WHEN a Transaction_Input has fewer than 2 postings, THE Journal_Writer SHALL return a validation error describing the issue
4. WHEN a Transaction_Input contains a Posting with an empty account name, THE Journal_Writer SHALL return a validation error describing the issue
5. WHEN all postings in a Transaction_Input have explicit amounts and those amounts do not sum to zero, THE Journal_Writer SHALL return a validation error describing the issue
6. WHEN a Transaction_Input contains more than one Posting with an omitted amount, THE Journal_Writer SHALL return a validation error describing the issue

### Requirement 3: Direct Journal Writer — File Append

**User Story:** As a developer, I want to append validated transactions to the journal file atomically, so that existing journal data is never corrupted.

#### Acceptance Criteria

1. WHEN a valid Transaction_Input is submitted, THE Journal_Writer SHALL validate, format, and append the transaction to the active journal file
2. WHEN appending a transaction, THE Journal_Writer SHALL preserve all existing content in the journal file
3. IF the Transaction_Input fails validation, THEN THE Journal_Writer SHALL reject the write and return the list of validation errors without modifying the journal file

### Requirement 4: Budget Assignment Transactions

**User Story:** As a user, I want to assign income to budget envelopes, so that every dollar of income is allocated to a spending category.

#### Acceptance Criteria

1. WHEN a user submits a budget assignment via the Budget_Page, THE App SHALL create a Budget_Assignment_Transaction that debits the Physical_Account and credits one or more Budget_Sub_Accounts
2. WHEN a budget assignment is created, THE App SHALL include a Balance_Assertion of `= $0.00` on the Physical_Account posting to ensure every dollar is assigned
3. WHEN a budget assignment is created, THE App SHALL record it as a cleared (`*`) transaction with the description "Budget Assignment"
4. WHEN income has not yet been assigned, THE App SHALL reflect the unassigned amount in the Unallocated_Account balance

### Requirement 5: Spending from Envelopes

**User Story:** As a user, I want expenses to debit from the correct budget envelope, so that I can track spending against my budget categories.

#### Acceptance Criteria

1. WHEN a user records an expense with an envelope category, THE App SHALL create a transaction that debits the expense account and credits the corresponding Budget_Sub_Account
2. WHEN a user records a credit card expense with an envelope category, THE App SHALL create a 4-posting transaction: expense debit, Budget_Sub_Account credit, pending credit card Budget_Sub_Account debit, and liability credit
3. WHEN recording an expense, THE App SHALL debit the Budget_Sub_Account (not the Physical_Account directly)

### Requirement 6: Envelope Transfers

**User Story:** As a user, I want to move money between envelopes, so that I can adjust my budget when priorities change.

#### Acceptance Criteria

1. WHEN a user transfers money between envelopes, THE App SHALL create a transaction that debits the source Budget_Sub_Account and credits the destination Budget_Sub_Account
2. WHEN an envelope transfer is created, THE App SHALL record it as a cleared (`*`) transaction with the description "Budget Transfer"
3. WHEN an envelope transfer is created, THE App SHALL ensure the transaction postings sum to zero

### Requirement 7: Budget Data Reading

**User Story:** As a user, I want to see my envelope balances and activity on the budget page, so that I know how much money is available in each category.

#### Acceptance Criteria

1. WHEN the Budget_Page is loaded, THE App SHALL display the Unallocated_Account balance as "Ready to Assign"
2. WHEN the Budget_Page is loaded, THE App SHALL display each envelope's current balance as the "Available" amount by querying hledger balances for `assets:checking:budget:*` sub-accounts
3. WHEN the Budget_Page is loaded, THE App SHALL display each envelope's spending as the "Activity" amount derived from expense transactions against that Budget_Sub_Account
4. WHEN the Budget_Page is loaded, THE App SHALL display each envelope's assigned amount derived from Budget_Assignment_Transaction credits to that Budget_Sub_Account

### Requirement 8: Budget API Endpoints

**User Story:** As a developer, I want dedicated API endpoints for budget operations, so that the UI can create assignments, transfers, and read envelope data.

#### Acceptance Criteria

1. WHEN a POST request is made to `/api/budget/assign` with envelope amounts, THE App SHALL create and persist a Budget_Assignment_Transaction to the journal
2. WHEN a POST request is made to `/api/budget/transfer` with source envelope, destination envelope, and amount, THE App SHALL create and persist an envelope transfer transaction to the journal
3. WHEN a GET request is made to `/api/budget`, THE App SHALL return envelope balances, activity, and assignments read from hledger data
4. WHEN a GET request is made to `/api/accounts`, THE App SHALL exclude Budget_Sub_Accounts from the response so that only physical accounts and liability accounts are returned

### Requirement 9: UI — Budget Page Interactions

**User Story:** As a user, I want to assign money to envelopes directly from the budget page, so that I can quickly distribute income without navigating away.

#### Acceptance Criteria

1. WHEN a user clicks the "Assigned" column for an envelope on the Budget_Page, THE App SHALL display an inline input field for entering or changing the assigned amount
2. WHEN a user submits an assignment amount via the inline input, THE App SHALL create a Budget_Assignment_Transaction and refresh the displayed balances
3. WHEN the Budget_Page displays the "Ready to Assign" amount, THE App SHALL show the Unallocated_Account balance prominently at the top of the page

### Requirement 10: UI — Transaction Form Envelope Mapping

**User Story:** As a user, I want the transaction form to automatically map my expense categories to budget envelopes, so that I don't have to think about the underlying account structure.

#### Acceptance Criteria

1. WHEN a user selects an expense category in the transaction form, THE App SHALL map it to the corresponding Budget_Sub_Account for the posting (e.g., selecting "Groceries" maps to `assets:checking:budget:food:groceries`)
2. WHEN a user selects a credit card as the payment account, THE App SHALL generate the 4-posting credit card transaction structure automatically
3. WHEN a user records income via the transaction form, THE App SHALL credit the Physical_Account (not a Budget_Sub_Account), leaving the money for later assignment

### Requirement 11: UI — Sidebar Account Filtering

**User Story:** As a user, I want the sidebar to show only real financial accounts, so that budget sub-accounts don't clutter my navigation.

#### Acceptance Criteria

1. THE Sidebar SHALL display only Physical_Accounts and liability accounts, excluding all Budget_Sub_Accounts from the account list
2. WHEN new Budget_Sub_Accounts are created through budget assignments, THE Sidebar SHALL continue to exclude them from display

### Requirement 12: Account Structure and Naming

**User Story:** As a developer, I want a consistent account naming convention for budget envelopes, so that the system can reliably identify and manage envelope accounts.

#### Acceptance Criteria

1. THE App SHALL create budget envelopes as sub-accounts under `assets:<account>:budget:<category>` where `<category>` mirrors the expense category structure
2. THE App SHALL maintain an Unallocated_Account at `assets:<account>:budget:unallocated` for each physical account with budget envelopes
3. WHEN identifying Budget_Sub_Accounts, THE App SHALL match accounts containing the `:budget:` path segment

### Requirement 13: Migration Compatibility

**User Story:** As an existing user, I want my current journal to continue working without changes, so that I can adopt envelope budgeting incrementally.

#### Acceptance Criteria

1. WHEN a journal has no Budget_Sub_Accounts, THE Budget_Page SHALL display $0 for all assigned and available amounts
2. WHEN a user first assigns money to an envelope, THE App SHALL create the necessary Budget_Sub_Accounts automatically by writing the assignment transaction
3. THE App SHALL not modify or require changes to existing transactions in the journal when enabling envelope budgeting
