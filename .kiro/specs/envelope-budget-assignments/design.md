# Design Document: Envelope Budget Assignments via hledger Sub-Accounts

## Overview

Implement YNAB-style envelope budgeting using hledger's native double-entry accounting. Instead of storing budget assignments in a separate config file, "assigning money to an envelope" is a real hledger transaction that moves money from a checking account into a budget sub-account. This approach is inspired by [zombor/hledger-envelope-budget](https://github.com/zombor/hledger-envelope-budget) and keeps all financial data in the plain-text journal.

## Reference Implementation

This design follows the patterns documented in [zombor/hledger-envelope-budget](https://github.com/zombor/hledger-envelope-budget). Key takeaways from that reference:

- Budget envelopes are hledger sub-accounts under `assets:cash:<bank>:budget:<category>`
- Income goes to the physical checking account, then a "Budgeting" transaction distributes it into envelope sub-accounts with a balance assertion (`= 0`) to ensure every dollar is assigned
- Spending debits from the budget sub-account, not the physical account
- Credit card purchases require 4 postings: expense debit, budget sub-account credit, pending credit card debit, liability credit — this ensures money is set aside to pay the card
- Moving money between envelopes is a simple transfer between budget sub-accounts ("Roll With The Punches")
- An `unallocated` sub-account holds money that hasn't been assigned to a specific envelope yet
- The sum of all budget sub-accounts should equal the physical bank balance at all times

## Core Concept

Every real account (e.g., `assets:checking`) gets a parallel set of budget sub-accounts:

```
assets:checking                          ← physical bank account (should be $0 in ledger)
assets:checking:budget:groceries         ← envelope for groceries
assets:checking:budget:rent              ← envelope for rent
assets:checking:budget:unallocated       ← money not yet assigned
```

When income arrives, it goes to the checking account. A "Budgeting" transaction then distributes that money into envelope sub-accounts. The checking account balance should always be $0 — all money lives in envelopes.

## How It Works

### Income Received
```
2025-03-01 * Salary
    assets:checking                    $3,500.00
    income:salary
```

### Assign Money to Envelopes
```
2025-03-01 * Budget Assignment
    assets:checking:budget:rent              $1,200.00
    assets:checking:budget:groceries           $400.00
    assets:checking:budget:transport            $60.00
    assets:checking:budget:entertainment        $50.00
    assets:checking:budget:unallocated       $1,790.00
    assets:checking                          = $0.00
```

The `= $0.00` balance assertion ensures every dollar is assigned.

### Spending from an Envelope
```
2025-03-03 * Grocery Store
    expenses:food:groceries              $110.00
    assets:checking:budget:groceries
```

Now `hledger bal budget:groceries` shows $290.00 remaining.

### Moving Money Between Envelopes (Roll With The Punches)
```
2025-03-15 * Budget Transfer
    assets:checking:budget:entertainment    $20.00
    assets:checking:budget:unallocated     $-20.00
```

## Account Structure

### Current (Simplified)
```
assets:checking
assets:savings
liabilities:credit-card
expenses:food:groceries
expenses:housing:rent
income:salary
```

### New (Envelope Model)
```
assets:checking                              ← physical account (always $0)
assets:checking:budget:food:groceries        ← envelope
assets:checking:budget:food:restaurants      ← envelope
assets:checking:budget:housing:rent          ← envelope
assets:checking:budget:housing:utilities     ← envelope
assets:checking:budget:transport             ← envelope
assets:checking:budget:entertainment         ← envelope
assets:checking:budget:unallocated           ← unassigned money
assets:savings                               ← physical account
liabilities:credit-card                      ← liability
expenses:food:groceries                      ← expense tracking
expenses:housing:rent                        ← expense tracking
income:salary                                ← income tracking
```

### Key Rules
1. Physical accounts (checking, savings) should have $0 balance — all money is in `:budget:*` sub-accounts
2. Envelope names under `:budget:` mirror the expense category structure (without the `expenses:` prefix)
3. Every account has a `:budget:unallocated` sub-account for money not yet assigned
4. The sum of all `:budget:*` sub-accounts equals the physical bank balance

## Architecture Changes

### Transaction Types (User Perspective)

| User Action | What Happens in hledger |
|---|---|
| Record income | Credit income account, debit checking → then assign to envelopes |
| Assign to envelope | Transfer from checking to budget sub-account |
| Record expense | Debit expense account, credit budget sub-account |
| Transfer between envelopes | Transfer between budget sub-accounts |
| Transfer between accounts | Transfer between physical accounts (then re-assign envelopes) |

### Budget Page Data

Instead of a separate budget config, the budget page reads directly from hledger:

- **Ready to Assign** = `hledger bal assets:checking:budget:unallocated` (money not yet in an envelope)
- **Assigned** per envelope = total credits to `assets:checking:budget:{category}` from budget assignment transactions
- **Activity** per envelope = total debits from `assets:checking:budget:{category}` (spending)
- **Available** per envelope = `hledger bal assets:checking:budget:{category}` (current balance)

### API Changes

| Endpoint | Change |
|---|---|
| `POST /api/transactions` | Expense transactions debit from `budget:*` sub-account instead of physical account |
| `POST /api/budget/assign` | NEW — creates a budget assignment transaction |
| `POST /api/budget/transfer` | NEW — moves money between envelopes |
| `GET /api/budget` | Reads envelope balances from hledger instead of config file |
| `GET /api/accounts` | Filters out `:budget:*` sub-accounts from sidebar display |

### UI Changes

| Component | Change |
|---|---|
| Budget page "Assigned" column | Clickable — opens inline input to assign/change amount |
| Budget page "Available" column | Shows live balance from hledger |
| Budget page "Ready to Assign" | Shows `budget:unallocated` balance |
| Transaction form | Expense "account" field maps to budget sub-account under the hood |
| Sidebar | Hides `:budget:*` sub-accounts, shows only physical accounts |

## Simplified Transaction Form Mapping

The user still sees the simple form (Account, Payee, Envelope, Inflow/Outflow). The app translates:

**Expense**: User picks Account=Checking, Envelope=Groceries, Outflow=$50
```
expenses:food:groceries                    $50.00
assets:checking:budget:food:groceries     $-50.00
```

**Income**: User picks Account=Checking, Inflow=$3500
```
assets:checking                          $3,500.00
income:salary                           $-3,500.00
```
Then the user assigns from the budget page.

**Assign to Envelope**: User clicks "Assigned" cell, types $400 for Groceries
```
assets:checking:budget:food:groceries      $400.00
assets:checking                           $-400.00
```
(Or from unallocated if already partially assigned)

## Credit Card Handling

Following the zombor model, credit card spending involves 4 postings:
```
2025-03-15 * Restaurant
    expenses:food:restaurants                         $45.00
    assets:checking:budget:food:restaurants           $-45.00
    assets:checking:budget:pending:credit-card         $45.00
    liabilities:credit-card                           $-45.00
```

This ensures money is set aside to pay the credit card. The app generates these 4 postings automatically when the user selects a credit card as the payment method.

## Migration Path

1. Existing journals without budget sub-accounts continue to work — the budget page just shows $0 assigned
2. When a user first assigns money, the app creates the budget sub-accounts automatically
3. No breaking changes to existing transactions — they just won't have envelope tracking until re-entered

## Correctness Properties

### P1: Physical account balance equals sum of budget sub-accounts
For any account with budget sub-accounts, `bal assets:checking` should equal `bal assets:checking:budget:*`.

### P2: Budget assignment transactions always balance
Every budget assignment transaction has postings that sum to zero.

### P3: Ready to Assign equals unallocated balance
The "Ready to Assign" amount always equals `bal assets:checking:budget:unallocated` plus any unassigned income in the physical account.

### P4: Available equals envelope balance
Each envelope's "Available" amount equals `bal assets:checking:budget:{category}`.

### P5: Expense transactions debit the correct envelope
When recording an expense with an envelope, the budget sub-account is debited, not the physical account.

## Direct Journal Writer (Prerequisite)

This feature requires replacing the current `hledger add` stdin-piping approach with direct file appending. Budget assignment transactions can have 5+ postings, and `hledger add`'s interactive stdin protocol is too fragile for this. Direct writing is faster, more predictable, and gives full control over validation.

### Motivation

Current issues with `hledger add`:
1. Does NOT reject unbalanced transactions when used via stdin
2. Spawns a child process for every transaction — slower than a file append
3. The stdin protocol (line-by-line prompts) is fragile and hard to debug
4. No control over formatting — hledger decides how to format the output
5. Cannot handle balance assertions (the `= $0.00` syntax needed for budget assignments)

Benefits of direct writing:
1. Full control over transaction validation before writing
2. Simple file append — no process spawning overhead
3. Deterministic formatting matching hledger conventions
4. Can validate balance (postings sum to zero) before writing
5. Supports balance assertions in postings

### Journal Format Rules

```
2025-01-15 * Coffee Shop
    expenses:dining                    $5.00
    assets:checking                   $-5.00

```

- First line: `DATE [STATUS] DESCRIPTION` where STATUS is `*` (cleared), `!` (pending), or omitted
- Posting lines: 4-space indent, account name, then amount right-aligned
- Amounts: commodity symbol + number with 2 decimal places (e.g., `$5.00`, `$-5.00`)
- Balance assertions: `account  amount = balance` (e.g., `assets:checking  = $0.00`)
- Blank line after the last posting to separate transactions
- Account names: colon-separated, lowercase

### Components

#### formatTransaction()

Convert a `TransactionInput` into a properly formatted hledger journal string.

```typescript
function formatTransaction(input: TransactionInput): string
```

**Preconditions:** input has a valid date, non-empty description, and at least 2 postings
**Postconditions:** Returns valid hledger journal syntax parseable by `hledger print`, starts with `\n` separator, ends with `\n`

#### validateTransaction()

Validate a `TransactionInput` before writing to ensure journal integrity.

```typescript
function validateTransaction(input: TransactionInput): string[]
```

**Validation rules:**
1. Date must be valid YYYY-MM-DD
2. Description must be non-empty
3. At least 2 postings required
4. All postings must have non-empty account names
5. Postings with explicit amounts must sum to zero (balanced)
6. At most one posting may omit the amount (hledger infers it)

#### appendTransaction()

Replace `addTransaction()` — validates, formats, and appends to the journal file.

```typescript
async function appendTransaction(input: TransactionInput): Promise<void>
```

**Steps:** validate → format → `fs.appendFile()`. No hledger process involved.

### Direct Writer Correctness Properties

#### P6: Formatted transactions are parseable by hledger
For any valid TransactionInput, `formatTransaction()` output appended to a valid journal file should produce a file that `hledger print` can parse without errors.

#### P7: Posting amounts always balance
For any valid TransactionInput with all explicit amounts, the sum of all posting amounts in the formatted output equals zero.

#### P8: Append is non-destructive
For any journal file content and valid TransactionInput, appending the formatted transaction preserves all existing transactions.

#### P9: Round-trip consistency
For any valid TransactionInput, formatting it and then parsing the result back via `hledger print -O json` should produce a transaction with matching date, description, and posting accounts/amounts.

### Testing Strategy

- Unit tests for `formatTransaction()`: verify output format for all transaction types (2-posting, 4-posting credit card, 5+ posting budget assignments)
- Unit tests for `validateTransaction()`: verify all validation rules
- Property tests with fast-check: P6 (parseable), P7 (balanced), P8 (non-destructive), P9 (round-trip)
- Integration test: full flow through POST /api/transactions → file append → GET /api/transactions returns the new transaction
