# Design Document: Credit Card Usage

## Status: Placeholder

## Overview

Implement full YNAB-style credit card handling in the envelope budgeting system. Credit card spending is already partially supported via the 4-posting transaction structure, but the UI and workflow need dedicated support for credit card payment tracking, the pending payment envelope, and the relationship between credit card debt and budget envelopes.

## Areas to Address

- Credit card spending: 4-posting structure (expense debit, budget credit, pending CC debit, liability credit) is implemented server-side but needs UI support in the transaction form
- Pending payment envelope: `assets:checking:budget:pending:credit-card` tracks money set aside for CC payments — needs visibility on the budget page
- Credit card payment recording: paying the CC bill should debit `pending:credit-card` and credit `liabilities:credit-card`
- Overspending on credit: when an envelope is overspent via CC, the overspent amount becomes CC debt not covered by the pending envelope
- Credit card balance vs. pending payment display: show how much of the CC balance is covered by the pending envelope vs. uncovered debt
- Multiple credit cards: support `pending:visa`, `pending:amex`, etc. mapped to specific liability accounts
- CC payment due date tracking
- Reconciliation between CC statement and pending payment envelope
- Interest/fee handling as unbudgeted CC debt

## Current Implementation

- `server/api/transactions.post.ts` generates 4-posting CC transactions via `applyEnvelopePostings()`
- `test-data/sample.journal` has example CC transactions with the pending envelope
- Budget page excludes `pending:*` from envelope display
- CC payments debit `pending:credit-card` and credit `liabilities:credit-card`

## TODO

- [ ] Flesh out detailed design
- [ ] Define CC-specific API endpoints
- [ ] Design budget page CC section
- [ ] Design transaction form CC flow
- [ ] Write requirements
- [ ] Create implementation tasks
