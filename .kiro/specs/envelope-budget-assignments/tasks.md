# Implementation Plan: Envelope Budget Assignments

## Overview

Implement YNAB-style envelope budgeting using hledger sub-accounts. The work is split into three phases: (1) a direct journal writer that replaces `hledger add` stdin-piping, (2) budget operation API endpoints (assign, transfer, spend), and (3) UI updates to the budget page, transaction form, and sidebar. All budget data lives in the hledger journal as real double-entry transactions.

## Tasks

- [x] 1. Implement Direct Journal Writer
  - [x] 1.1 Extend types for balance assertions and direct writing
    - Add optional `balanceAssertion` field to `PostingInput` in `types/api.ts` (e.g., `balanceAssertion?: number`)
    - _Requirements: 1.1, 1.2, 1.5_

  - [x] 1.2 Implement `validateTransaction()` in `server/utils/journalWriter.ts`
    - Create `server/utils/journalWriter.ts`
    - Implement validation: date must be YYYY-MM-DD, description non-empty, at least 2 postings, all accounts non-empty, explicit amounts sum to zero, at most one omitted amount
    - Return an array of error strings (empty = valid)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 1.3 Implement `formatTransaction()` in `server/utils/journalWriter.ts`
    - Format `TransactionInput` into valid hledger journal syntax
    - First line: `DATE [STATUS] DESCRIPTION`
    - Posting lines: 4-space indent, account name, commodity+amount with 2 decimal places
    - Support balance assertions (`= $0.00`) on postings
    - Omit amount for postings with no explicit amount
    - Prepend `\n` separator, end with `\n`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.4 Write property tests for `formatTransaction()` and `validateTransaction()`
    - **Property P7: Posting amounts always balance** — for any valid TransactionInput with all explicit amounts, the sum of posting amounts in formatted output equals zero
    - **Validates: Requirements 2.5**
    - **Property P6: Formatted transactions are parseable by hledger** — for any valid TransactionInput, `formatTransaction()` output is valid hledger journal syntax
    - **Validates: Requirements 1.1**

  - [x] 1.5 Write unit tests for `validateTransaction()` and `formatTransaction()`
    - Test each validation rule (invalid date, empty description, <2 postings, empty account, unbalanced, multiple omitted amounts)
    - Test formatting for 2-posting, 4-posting credit card, 5+ posting budget assignment transactions
    - Test balance assertion formatting
    - Test omitted amount formatting
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 1.6 Implement `appendTransaction()` in `server/utils/journalWriter.ts`
    - Validate input, format, and append to journal file via `fs.appendFile()`
    - If validation fails, reject with error list without modifying the file
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 1.7 Write property tests for `appendTransaction()`
    - **Property P8: Append is non-destructive** — for any journal content and valid TransactionInput, appending preserves all existing content
    - **Validates: Requirements 3.2**

  - [x] 1.8 Replace `addTransaction()` usage with `appendTransaction()` in `server/api/transactions.post.ts`
    - Update the POST handler to call `appendTransaction()` instead of `addTransaction()`
    - Handle validation errors by returning 400 with error details
    - _Requirements: 3.1, 3.3_

- [x] 2. Checkpoint — Direct Journal Writer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement Budget Assignment and Transfer API Endpoints
  - [x] 3.1 Create `POST /api/budget/assign` endpoint in `server/api/budget/assign.post.ts`
    - Accept request body with envelope amounts (map of envelope name → amount)
    - Build a Budget_Assignment_Transaction: debit physical account, credit each budget sub-account
    - Include `= $0.00` balance assertion on the physical account posting
    - Record as cleared (`*`) with description "Budget Assignment"
    - Use `appendTransaction()` to write to journal
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 3.2 Create `POST /api/budget/transfer` endpoint in `server/api/budget/transfer.post.ts`
    - Accept source envelope, destination envelope, and amount
    - Build a transfer transaction: debit source budget sub-account, credit destination budget sub-account
    - Record as cleared (`*`) with description "Budget Transfer"
    - Ensure postings sum to zero
    - Use `appendTransaction()` to write to journal
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 3.3 Update `POST /api/transactions` for envelope-aware expense handling
    - When a simplified expense transaction includes an envelope category, map the debit posting to the corresponding `assets:checking:budget:<category>` sub-account instead of the physical account
    - When a credit card is the payment account, generate the 4-posting structure: expense debit, budget sub-account credit, pending credit card budget debit, liability credit
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 3.4 Write unit tests for budget assign and transfer endpoints
    - Test budget assignment creates correct multi-posting transaction with balance assertion
    - Test budget transfer creates correct 2-posting transaction
    - Test expense with envelope maps to budget sub-account
    - Test credit card expense generates 4-posting structure
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 6.1, 6.2, 6.3_

  - [x] 3.5 Write property test for budget assignment balance
    - **Property P2: Budget assignment transactions always balance** — every budget assignment transaction has postings that sum to zero
    - **Validates: Requirements 4.1, 4.2**

  - [x] 3.6 Write property test for expense envelope debit
    - **Property P5: Expense transactions debit the correct envelope** — when recording an expense with an envelope, the budget sub-account is debited, not the physical account
    - **Validates: Requirements 5.1, 5.3**

- [x] 4. Checkpoint — Budget API Endpoints
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update Budget Data Reading and Account Filtering
  - [x] 5.1 Update `GET /api/budget` to read envelope balances from hledger sub-accounts
    - Query `hledger bal assets:checking:budget:*` for envelope balances (Available)
    - Query unallocated balance for Ready to Assign
    - Derive Assigned amounts from budget assignment transaction credits
    - Derive Activity from expense transactions against budget sub-accounts
    - Update `BudgetEnvelopeReport` response to use real hledger data
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.3_

  - [x] 5.2 Update `GET /api/accounts` to filter out `:budget:*` sub-accounts
    - Update `filterRealAccounts()` in `utils/filterAccounts.ts` to exclude accounts containing `:budget:`
    - Ensure only physical accounts and liability accounts are returned when `type=real`
    - _Requirements: 8.4, 11.1, 11.2_

  - [x] 5.3 Write unit tests for updated budget data reading and account filtering
    - Test that budget endpoint returns correct Available, Assigned, Activity, and Ready to Assign values
    - Test that accounts endpoint excludes `:budget:*` sub-accounts
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.4, 11.1_

  - [x] 5.4 Write property test for budget data consistency
    - **Property P3: Ready to Assign equals unallocated balance** — the Ready to Assign amount always equals the unallocated account balance plus unassigned income
    - **Validates: Requirements 7.1**
    - **Property P4: Available equals envelope balance** — each envelope's Available amount equals its hledger balance
    - **Validates: Requirements 7.2**

- [x] 6. Checkpoint — Budget Data and Account Filtering
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Account Structure and Naming Utilities
  - [x] 7.1 Create budget account naming utilities in `utils/budgetAccounts.ts`
    - `toBudgetSubAccount(physicalAccount, category)` — maps e.g. `assets:checking` + `food:groceries` → `assets:checking:budget:food:groceries`
    - `toUnallocatedAccount(physicalAccount)` — returns e.g. `assets:checking:budget:unallocated`
    - `isBudgetSubAccount(account)` — returns true if account contains `:budget:`
    - `extractEnvelopeName(budgetAccount)` — extracts category from budget sub-account path
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 7.2 Write unit tests for budget account naming utilities
    - Test mapping from physical account + category to budget sub-account
    - Test unallocated account generation
    - Test budget sub-account detection
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 8. Implement UI — Budget Page Inline Assignment
  - [x] 8.1 Add inline assignment input to budget page "Assigned" column
    - Make the "Assigned" cell clickable to reveal an inline input field
    - On submit, call `POST /api/budget/assign` with the entered amount for that envelope
    - Refresh budget data after successful assignment
    - Show "Ready to Assign" (unallocated balance) prominently at the top of the page
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 8.2 Update budget page to display live hledger envelope data
    - Display Available column from hledger balance queries
    - Display Activity column from expense transactions
    - Display Assigned column from budget assignment credits
    - _Requirements: 7.2, 7.3, 7.4, 9.3_

- [x] 9. Implement UI — Transaction Form Envelope Mapping
  - [x] 9.1 Update `SimplifiedTransactionForm.vue` for envelope-aware expense posting
    - When user selects an expense category, map it to the corresponding budget sub-account for the posting
    - When user selects a credit card as payment account, generate the 4-posting credit card structure automatically
    - When user records income, credit the physical account (not a budget sub-account)
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 9.2 Update `toTransactionInput()` to generate envelope-aware postings
    - For expenses: debit expense account, credit budget sub-account (not physical account)
    - For credit card expenses: generate 4-posting structure
    - For income: credit physical account as before
    - _Requirements: 5.1, 5.2, 5.3, 10.1, 10.2, 10.3_

  - [x] 9.3 Write unit tests for updated `toTransactionInput()` envelope mapping
    - Test expense generates budget sub-account posting
    - Test credit card expense generates 4-posting structure
    - Test income still credits physical account
    - _Requirements: 5.1, 5.2, 10.1, 10.2, 10.3_

- [x] 10. Implement UI — Sidebar Account Filtering
  - [x] 10.1 Update sidebar to hide `:budget:*` sub-accounts
    - Ensure the sidebar account list uses the updated `filterRealAccounts()` that excludes budget sub-accounts
    - Verify new budget sub-accounts created through assignments are also excluded
    - _Requirements: 11.1, 11.2_

- [x] 11. Migration Compatibility
  - [x] 11.1 Ensure backward compatibility with existing journals
    - Journals without budget sub-accounts should show $0 for all assigned/available amounts on the budget page
    - First budget assignment should create budget sub-accounts automatically via the transaction
    - Existing transactions should not be modified
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 11.2 Write integration tests for migration scenarios
    - Test budget page with a journal that has no budget sub-accounts shows $0
    - Test first assignment creates budget sub-accounts
    - Test existing transactions are preserved after enabling envelope budgeting
    - _Requirements: 13.1, 13.2, 13.3_

- [x] 12. Final Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (P1–P9)
- The direct journal writer (tasks 1.x) is a prerequisite for all budget operations
- TypeScript is used throughout — matching the existing Nuxt/vitest/fast-check stack
