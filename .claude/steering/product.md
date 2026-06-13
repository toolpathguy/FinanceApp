# Product

## What this is
A friendly budgeting app on top of the hledger plain-text accounting CLI. It
hides double-entry accounting entirely — users think in YNAB terms (accounts,
payees, categories/envelopes, inflow/outflow), never postings or debits/credits.

## Core model (YNAB-style)
- **Account** — a real financial account (checking, savings, credit card) →
  hledger `assets:*` / `liabilities:*`.
- **Payee** — free text, stored in the transaction description.
- **Category / Envelope** — a budget bucket → hledger `expenses:*` / `income:*`,
  with real envelope sub-accounts under `assets:checking:budget:*`.
- **Inflow / Outflow** — direction shown by column; amounts always display positive.

## Key product rules
- Envelope budgeting follows **YNAB Rule 1**: every dollar has a job. "Ready to
  Assign" = net real-account balance − sum of envelope balances.
- Accounts ≠ categories. Real accounts are managed on the accounts page;
  categories/envelopes are managed on the budget page.
- Hidden envelopes must have a **zero balance** before hiding (no money vanishes).
- Display: inflows green, outflows red, transfers neutral; UI strips hledger
  prefixes (`assets:checking` → "Checking"). "Category" is labeled "Envelope".

See `.kiro/steering/hledger-budget-app-design.md` for the full envelope model,
transaction-type mappings, and page/API status.
