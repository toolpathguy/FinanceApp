# Implementation Plan: YNAB-Style Simplified Transaction Model

## Overview

Transform the existing raw double-entry posting UI into a YNAB-inspired UX. Implementation proceeds bottom-up: new TypeScript types, pure utility functions (with property tests), server API changes, composable updates, and finally Vue components. Each step builds on the previous, ensuring no orphaned code.

## Tasks

- [x] 1. Define new TypeScript types and interfaces
  - [x] 1.1 Add simplified transaction types to `types/ui.ts`
    - Add `TransactionType`, `SimplifiedTransactionInput`, `SimplifiedFormState`, `RegisterRow`, `RealAccount` interfaces
    - Add `BudgetCategory`, `BudgetCategoryGroup`, `BudgetEnvelopeReport` interfaces (replacing `BudgetRow`/`BudgetReport`)
    - _Requirements: 1.1, 4.1, 5.1, 8.1, 8.2, 8.3, 8.4_

- [x] 2. Implement core utility functions
  - [x] 2.1 Create `utils/stripAccountPrefix.ts`
    - Implement `stripAccountPrefix()` that removes the first colon-separated segment and title-cases remaining segments
    - Return original string title-cased if no colon found
    - _Requirements: 7.1, 7.2, 7.3_

  - [x]* 2.2 Write property test for stripAccountPrefix
    - **Property 12: Strip account prefix behavior**
    - **Validates: Requirements 7.1, 7.2**

  - [x] 2.3 Create `utils/filterAccounts.ts`
    - Implement `filterRealAccounts()` returning only `assets:`/`liabilities:` accounts
    - Implement `filterCategoryAccounts()` returning only `expenses:`/`income:` accounts
    - Both preserve original order
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x]* 2.4 Write property test for account filtering
    - **Property 7: Account filter correctness and disjointness**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  - [x] 2.5 Create `utils/deriveTransactionType.ts`
    - Implement `deriveTransactionType()` that returns `'transfer'`/`'income'`/`'expense'` based on form state fields
    - _Requirements: 3.1, 3.2, 3.3_

  - [x]* 2.6 Write property test for deriveTransactionType
    - **Property 11: Transaction type derivation correctness**
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 2.7 Create `utils/validateSimplifiedForm.ts`
    - Implement `validateSimplifiedForm()` returning error message array
    - Validate: date format, payee non-empty, account selected, exactly one of inflow/outflow, positive amount, category/transferAccount rules, same-account transfer check
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x]* 2.8 Write property tests for validateSimplifiedForm
    - **Property 9: Form validation rejects all invalid states**
    - **Property 10: Form validation accepts all valid states**
    - **Validates: Requirements 2.1–2.9**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement transaction conversion and register row derivation
  - [x] 4.1 Create `utils/toTransactionInput.ts`
    - Implement `toTransactionInput()` converting `SimplifiedTransactionInput` to `TransactionInput` with exactly 2 balanced postings
    - Implement `formStateToInput()` converting `SimplifiedFormState` to `SimplifiedTransactionInput`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x]* 4.2 Write property tests for toTransactionInput
    - **Property 1: Transaction conversion always produces balanced postings**
    - **Property 2: Transaction conversion maps posting accounts correctly by type**
    - **Property 3: Transaction conversion preserves date and payee**
    - **Validates: Requirements 4.1–4.7**

  - [x] 4.3 Create `utils/toRegisterRows.ts`
    - Implement `toRegisterRows()` converting `HledgerTransaction[]` + account path to `RegisterRow[]`
    - Derive payee, category, inflow/outflow, running balance, transfer detection
    - Handle legacy transactions with >2 postings (show "Split" category)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 13.1, 13.2_

  - [x]* 4.4 Write property tests for toRegisterRows
    - **Property 4: Register row inflow/outflow mutual exclusivity**
    - **Property 5: Register running balance is cumulative sum**
    - **Property 6: Transfer detection and category derivation**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6**

  - [x]* 4.5 Write property test for round-trip conversion
    - **Property 8: Transaction type round-trip through conversion and register**
    - **Validates: Requirements 3.1, 3.2, 3.3, 5.2, 5.3**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update server APIs
  - [x] 6.1 Update `server/api/transactions.post.ts` to accept SimplifiedTransactionInput
    - Detect whether body is `SimplifiedTransactionInput` or legacy `TransactionInput`
    - If simplified, convert via `toTransactionInput()` before calling `addTransaction()`
    - Return 201 on success, 500 with hledger stderr on failure
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 6.2 Update `server/api/transactions.get.ts` to return RegisterRow[] when account filter is present
    - When `account` query param is provided, transform results through `toRegisterRows()`
    - When no account filter, return raw `HledgerTransaction[]` for backward compatibility
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 6.3 Update `server/api/accounts.get.ts` to support type filtering
    - Add `type` query param: `real`, `category`, or `all` (default `all`)
    - Use `filterRealAccounts()` / `filterCategoryAccounts()` accordingly
    - _Requirements: 6.1, 6.2, 6.5_

  - [x] 6.4 Create `server/api/budget.get.ts` for envelope model
    - Query hledger balance reports for expense accounts in the requested period
    - Build and return `BudgetEnvelopeReport` with readyToAssign, categoryGroups, totals
    - _Requirements: 12.1, 12.2, 8.1, 8.2, 8.5_

  - [x] 6.5 Create `server/api/categories.post.ts` for category management
    - Support create and delete operations for expense account categories
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Update composables
  - [x] 8.1 Update `composables/useAccounts.ts` to support type filtering
    - Accept optional `type` parameter (`real`, `category`, `all`)
    - Pass type to the accounts API
    - _Requirements: 6.5_

  - [x] 8.2 Update `composables/useTransactions.ts` to return RegisterRow[] when account is specified
    - When account query is provided, type the response as `RegisterRow[]`
    - _Requirements: 11.3_

  - [x] 8.3 Update `composables/useBudget.ts` to use BudgetEnvelopeReport
    - Point to the new budget API and return `BudgetEnvelopeReport` type
    - _Requirements: 8.1, 12.2_

- [x] 9. Build Vue components
  - [x] 9.1 Create simplified transaction form component
    - Build `components/SimplifiedTransactionForm.vue` with date, account dropdown, payee input, category dropdown, inflow/outflow fields
    - Implement mutual exclusivity: entering inflow clears outflow and vice versa
    - Implement transfer mode toggle when transfer account is selected instead of category
    - Wire validation via `validateSimplifiedForm()` and submission via `formStateToInput()` + POST API
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 9.2 Create account register view component
    - Build `components/AccountRegister.vue` displaying RegisterRow[] in a table with Date, Payee, Category, Inflow, Outflow, Running Balance columns
    - Color inflows green, outflows red, transfers neutral
    - Show "Split" category with tooltip for >2 posting transactions
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 13.1_

  - [x] 9.3 Update sidebar in `layouts/default.vue` to show only real accounts
    - Use `useAccounts('real')` to fetch only assets/liabilities accounts
    - Display names via `stripAccountPrefix()` (e.g., "Checking" instead of "assets:checking")
    - _Requirements: 6.5, 7.4_

  - [x] 9.4 Update `pages/accounts/[...path].vue` to use register view and simplified form
    - Replace existing transaction list with `AccountRegister` component
    - Replace existing transaction form with `SimplifiedTransactionForm` component
    - _Requirements: 1.1, 5.1, 11.3_

  - [x] 9.5 Update `pages/budget.vue` with envelope model
    - Display Ready to Assign amount
    - Render category groups with Assigned/Activity/Available columns
    - Show group totals
    - Add category management UI (create/delete)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (Properties 1–14)
- Budget "assigned" amounts are initially read-only (derived from hledger budget directives); interactive assignment is a future enhancement
- The existing `TransactionFormState` and `BudgetReport`/`BudgetRow` types will be superseded but not removed, to avoid breaking any legacy references until migration is complete
