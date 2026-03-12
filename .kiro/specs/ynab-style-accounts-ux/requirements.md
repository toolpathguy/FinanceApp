# Requirements Document

## Introduction

This document defines the requirements for the YNAB-Style Simplified Transaction Model feature. The feature replaces the raw double-entry posting UI with a YNAB-inspired UX where users interact with Accounts, Payees, Categories, and Inflow/Outflow fields. The underlying hledger journal continues to use standard double-entry postings, but the app translates between the simplified user model and hledger's format transparently. The scope covers a simplified transaction form, a YNAB-style account register view, sidebar filtering for real accounts, a budget page with envelope-style category management, and all supporting API/type/utility changes.

## Glossary

- **Simplified_Transaction_Form**: The UI component that replaces the raw postings form with YNAB-style fields (Account, Payee, Category, Inflow/Outflow)
- **Account_Register**: The YNAB-style transaction list view for a single account showing Date, Payee, Category, Inflow, Outflow, and Running Balance columns
- **Sidebar**: The left navigation panel displaying the account tree, filtered to show only real accounts
- **Budget_Page**: The envelope-model budget view showing Ready to Assign, category groups, and per-category Assigned/Activity/Available
- **Transaction_Converter**: The server-side utility that converts SimplifiedTransactionInput into a standard TransactionInput with correct hledger postings
- **Real_Account**: A financial account representing a real-world asset or liability (hledger accounts starting with `assets:` or `liabilities:`)
- **Category**: A budget envelope mapped to an hledger expense or income account (accounts starting with `expenses:` or `income:`)
- **Inflow**: Money entering an account, represented as a positive amount
- **Outflow**: Money leaving an account, represented as a positive amount displayed to the user
- **Running_Balance**: A cumulative sum of inflows minus outflows for a given account, computed row by row
- **Payee**: Free text describing who the user paid or received money from, stored in the hledger transaction description
- **Transfer**: A transaction that moves money between two Real_Accounts without involving a Category
- **Form_Validator**: The client-side utility function that validates SimplifiedFormState and returns error messages
- **Account_Filter**: The utility function that partitions hledger account paths into real accounts and category accounts
- **Prefix_Stripper**: The utility function that removes the top-level hledger account prefix and title-cases the remainder for display

## Requirements

### Requirement 1: Simplified Transaction Form Rendering

**User Story:** As a user, I want to add transactions using familiar YNAB-style fields (Account, Payee, Category, Inflow/Outflow), so that I never have to think about double-entry postings.

#### Acceptance Criteria

1. WHEN the user opens the add-transaction form, THE Simplified_Transaction_Form SHALL display fields for date, account dropdown, payee text input, category dropdown, inflow amount, and outflow amount
2. WHEN the user enters a value in the inflow field, THE Simplified_Transaction_Form SHALL clear the outflow field
3. WHEN the user enters a value in the outflow field, THE Simplified_Transaction_Form SHALL clear the inflow field
4. WHEN the user selects a transfer target account instead of a category, THE Simplified_Transaction_Form SHALL hide the category dropdown and display the transfer account dropdown
5. WHEN the user submits a valid form, THE Simplified_Transaction_Form SHALL send a SimplifiedTransactionInput to the POST /api/transactions endpoint

### Requirement 2: Form Validation

**User Story:** As a user, I want immediate feedback when my transaction form has errors, so that I can correct mistakes before submitting.

#### Acceptance Criteria

1. WHEN the user submits a form with an empty payee field, THE Form_Validator SHALL return an error message indicating the payee is required
2. WHEN the user submits a form with no account selected, THE Form_Validator SHALL return an error message indicating an account is required
3. WHEN the user submits a form with both inflow and outflow filled, THE Form_Validator SHALL return an error message indicating only one of inflow or outflow is allowed
4. WHEN the user submits a form with neither inflow nor outflow filled, THE Form_Validator SHALL return an error message indicating an amount is required
5. WHEN the user submits a form with a non-numeric or zero or negative amount, THE Form_Validator SHALL return an error message indicating the amount must be a positive number
6. WHEN the user submits an expense or income form with no category selected, THE Form_Validator SHALL return an error message indicating a category is required
7. WHEN the user submits a transfer form where the source and destination accounts are the same, THE Form_Validator SHALL return an error message indicating the transfer destination must differ from the source
8. WHEN the user submits a form with an invalid date format, THE Form_Validator SHALL return an error message indicating the date must be in YYYY-MM-DD format
9. WHEN all form fields are valid, THE Form_Validator SHALL return an empty array of error messages

### Requirement 3: Transaction Type Derivation

**User Story:** As a user, I want the app to automatically determine whether my transaction is an expense, income, or transfer based on the fields I fill in, so that I do not have to manually select a transaction type.

#### Acceptance Criteria

1. WHEN the form has a non-empty transfer account, THE Simplified_Transaction_Form SHALL derive the transaction type as "transfer"
2. WHEN the form has a non-empty inflow and an empty outflow and no transfer account, THE Simplified_Transaction_Form SHALL derive the transaction type as "income"
3. WHEN the form has a non-empty outflow and an empty inflow and no transfer account, THE Simplified_Transaction_Form SHALL derive the transaction type as "expense"

### Requirement 4: Transaction-to-Postings Conversion

**User Story:** As a user, I want my simplified transactions to be correctly converted into balanced hledger double-entry postings, so that my journal file remains valid.

#### Acceptance Criteria

1. WHEN the Transaction_Converter receives a valid SimplifiedTransactionInput, THE Transaction_Converter SHALL produce a TransactionInput with exactly two postings
2. WHEN the Transaction_Converter produces two postings, THE Transaction_Converter SHALL ensure the two posting amounts sum to zero
3. WHEN the transaction type is "expense", THE Transaction_Converter SHALL create a debit posting to the expense category account and a credit posting to the source Real_Account
4. WHEN the transaction type is "income", THE Transaction_Converter SHALL create a debit posting to the destination Real_Account and a credit posting to the income category account
5. WHEN the transaction type is "transfer", THE Transaction_Converter SHALL create a debit posting to the transfer target Real_Account and a credit posting to the source Real_Account
6. THE Transaction_Converter SHALL set the TransactionInput description to the payee value from the SimplifiedTransactionInput
7. THE Transaction_Converter SHALL set the TransactionInput date to the date value from the SimplifiedTransactionInput

### Requirement 5: Account Register Display

**User Story:** As a user, I want to view my transactions in a YNAB-style register with Date, Payee, Category, Inflow, Outflow, and Running Balance columns, so that I can easily understand my account activity.

#### Acceptance Criteria

1. WHEN the Account_Register receives a list of HledgerTransactions for a given account, THE Account_Register SHALL produce one RegisterRow per transaction
2. WHEN a transaction posting amount for the viewed account is positive, THE Account_Register SHALL display the amount in the inflow column and set outflow to null
3. WHEN a transaction posting amount for the viewed account is negative, THE Account_Register SHALL display the absolute value in the outflow column and set inflow to null
4. THE Account_Register SHALL compute the Running_Balance for each row as the cumulative sum of all inflow minus outflow values from the first row to the current row
5. WHEN the other posting in a transaction belongs to a Real_Account, THE Account_Register SHALL mark the row as a transfer, set the category to empty, and prefix the payee with "Transfer: " followed by the other account display name
6. WHEN the other posting in a transaction belongs to a Category account, THE Account_Register SHALL set the category to the other posting account name with the top-level prefix stripped and title-cased
7. THE Account_Register SHALL display inflow values in green, outflow values in red, and transfer amounts in neutral color

### Requirement 6: Account Filtering

**User Story:** As a user, I want the sidebar to show only my real financial accounts (bank accounts, credit cards) and hide expense/income categories, so that the navigation matches how I think about my money.

#### Acceptance Criteria

1. THE Account_Filter SHALL return only accounts starting with "assets:" or "liabilities:" when filtering for real accounts
2. THE Account_Filter SHALL return only accounts starting with "expenses:" or "income:" when filtering for category accounts
3. THE Account_Filter SHALL produce disjoint sets for real accounts and category accounts with no overlap
4. THE Account_Filter SHALL preserve the original order of accounts in the filtered results
5. WHEN the Sidebar displays accounts, THE Sidebar SHALL use the Account_Filter to show only Real_Accounts

### Requirement 7: Account Name Display

**User Story:** As a user, I want account names displayed without hledger prefixes (e.g., "Checking" instead of "assets:checking"), so that the UI feels clean and familiar.

#### Acceptance Criteria

1. WHEN the Prefix_Stripper receives an account path with a colon separator, THE Prefix_Stripper SHALL remove the first segment and return the remainder
2. WHEN the Prefix_Stripper receives a multi-segment path, THE Prefix_Stripper SHALL title-case each remaining segment for display
3. WHEN the Prefix_Stripper receives a string with no colon, THE Prefix_Stripper SHALL return the original string title-cased
4. THE Sidebar SHALL use the Prefix_Stripper to display Real_Account names without the "assets:" or "liabilities:" prefix

### Requirement 8: Budget Page Envelope Model

**User Story:** As a user, I want a YNAB-style budget page showing Ready to Assign, category groups, and per-category Assigned/Activity/Available, so that I can manage my budget envelopes.

#### Acceptance Criteria

1. WHEN the Budget_Page loads, THE Budget_Page SHALL display the "Ready to Assign" amount calculated as total income minus total assigned across all categories
2. WHEN the Budget_Page loads, THE Budget_Page SHALL group categories by their top-level expense account into category groups
3. WHEN displaying a category row, THE Budget_Page SHALL show the Assigned amount, the Activity amount (actual spending from transactions), and the Available amount (assigned minus absolute activity)
4. WHEN displaying a category group, THE Budget_Page SHALL show the sum totals for Assigned, Activity, and Available across all categories in the group
5. THE Budget_Page SHALL retrieve activity data from hledger balance reports for expense accounts

### Requirement 9: Category Management

**User Story:** As a user, I want to create, rename, and delete budget categories from the budget page, so that I can organize my spending envelopes.

#### Acceptance Criteria

1. WHEN a user creates a new category, THE Budget_Page SHALL create a corresponding hledger expense account
2. WHEN a user deletes a category, THE Budget_Page SHALL remove the corresponding hledger expense account
3. THE Budget_Page SHALL manage categories separately from Real_Accounts, keeping the accounts page strictly for financial accounts

### Requirement 10: Server API for Simplified Transactions

**User Story:** As a developer, I want the POST /api/transactions endpoint to accept SimplifiedTransactionInput and convert it to hledger postings, so that the frontend only deals with the simplified model.

#### Acceptance Criteria

1. WHEN the POST /api/transactions endpoint receives a valid SimplifiedTransactionInput, THE endpoint SHALL convert the input to a TransactionInput using the Transaction_Converter and pass the result to hledger add
2. WHEN hledger add succeeds, THE endpoint SHALL return a 201 Created response
3. IF hledger add fails, THEN THE endpoint SHALL return a 500 response containing the hledger stderr message

### Requirement 11: Account Register API

**User Story:** As a developer, I want the GET /api/transactions endpoint to return RegisterRow arrays when filtered by account, so that the frontend can render the YNAB-style register directly.

#### Acceptance Criteria

1. WHEN the GET /api/transactions endpoint receives an account query parameter, THE endpoint SHALL fetch transactions from hledger print filtered by that account
2. WHEN the endpoint has fetched raw HledgerTransactions, THE endpoint SHALL transform the transactions into RegisterRow arrays using the toRegisterRows function
3. THE endpoint SHALL return RegisterRow objects containing date, payee, category, inflow, outflow, runningBalance, isTransfer, transactionIndex, and status fields

### Requirement 12: Budget API

**User Story:** As a developer, I want a GET /api/budget endpoint that returns the BudgetEnvelopeReport, so that the budget page can render the envelope model.

#### Acceptance Criteria

1. WHEN the GET /api/budget endpoint is called with a period parameter, THE endpoint SHALL query hledger balance reports for expense accounts in that period
2. THE endpoint SHALL return a BudgetEnvelopeReport containing readyToAssign, categoryGroups with per-category assigned/activity/available, and period totals

### Requirement 13: Legacy Transaction Handling

**User Story:** As a user, I want to see transactions with more than 2 postings (created outside the app) displayed gracefully in the register, so that legacy data does not break the UI.

#### Acceptance Criteria

1. WHEN the Account_Register encounters a transaction with more than two postings, THE Account_Register SHALL display the category as "Split" with a tooltip listing all other postings
2. WHEN the Account_Register encounters a transaction with more than two postings, THE Account_Register SHALL derive inflow or outflow from the current account's posting amount
