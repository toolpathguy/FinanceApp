# Implementation Plan: hledger Budget App — Basics

## Overview

Scaffold a Nuxt 4 + Nuxt UI app that wraps the hledger CLI. Implementation proceeds bottom-up: shared types → server utils → API routes → Docker setup. All journal writes go through `hledger add` via stdin — the app never writes to the journal file directly.

## Tasks

- [x] 1. Initialize Nuxt project and shared types
  - [x] 1.1 Create feature branch `feat/hledger-budget-app-basics` off `main`
  - [x] 1.2 Scaffold Nuxt 4 project with `nuxt.config.ts` configuring `@nuxt/ui` module, `compatibilityDate`, and devtools
    - Create `nuxt.config.ts` with `@nuxt/ui` module
    - Create `package.json` with `nuxt`, `@nuxt/ui`, and TypeScript dependencies
    - Create `app.vue` with a minimal `<NuxtPage />` shell
    - _Requirements: 8.5_

  - [x] 1.3 Create shared type definitions in `types/hledger.ts` and `types/api.ts`
    - Define `HledgerAmount`, `HledgerPosting`, `HledgerTransaction`, `HledgerBalanceRow`, `HledgerBalanceReport` in `types/hledger.ts`
    - Define `TransactionInput`, `PostingInput`, `BalanceQuery`, `TransactionQuery` in `types/api.ts`
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 2. Implement server utils — `server/utils/hledger.ts`
  - [x] 2.1 Implement `resolveJournalPath` function
    - Return `process.env.LEDGER_FILE` when set, otherwise `/data/main.journal`
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 2.2 Write property test for `resolveJournalPath` (Property 3)
    - **Property 3: Path resolution returns a non-empty string**
    - For any environment configuration, `resolveJournalPath()` returns a non-empty string matching the expected value
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [x] 2.3 Implement `hledgerExec` function
    - Spawn hledger with provided args, `-f <journalPath>`, and `-O json`
    - Collect stdout/stderr, parse JSON on success, throw on non-zero exit
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 2.4 Implement `addTransaction` function
    - Pipe stdin lines to `hledger add`: date, description, account/amount pairs, `.` (end postings), `y` (confirm), `.` (quit)
    - For postings with explicit amounts, format as `${commodity}${amount.toFixed(2)}`; for inferred amounts, send empty string
    - Default commodity to `$` when not specified
    - The app must NOT write to the journal file directly — only `hledger add` modifies it
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.5 Write property test for `addTransaction` round-trip (Property 1)
    - **Property 1: addTransaction round-trip**
    - For any valid `TransactionInput`, after `addTransaction(input)` succeeds, the journal contains a matching transaction
    - **Validates: Requirements 3.1, 3.2**

  - [x] 2.6 Write property test for `addTransaction` rejection of invalid input (Property 2)
    - **Property 2: addTransaction rejects invalid input**
    - For any `TransactionInput` with unbalanced explicit amounts, `addTransaction` throws and the journal is unchanged
    - **Validates: Requirements 3.3**

  - [x] 2.7 Write property test for sole journal writer (Property 4)
    - **Property 4: hledger is the sole journal writer**
    - For any call to `addTransaction`, the app does not directly write to the journal file — only `hledger add` modifies it
    - **Validates: Requirements 3.4**

- [x] 3. Checkpoint — Verify server utils
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement API routes
  - [x] 4.1 Implement `GET /api/balances` in `server/api/balances.get.ts`
    - Parse `period`, `account`, `depth` from query params
    - Build hledger `bal` args with optional `-p`, account filter, `--depth` flags
    - Call `hledgerExec` and return result
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 4.2 Implement `GET /api/transactions` in `server/api/transactions.get.ts`
    - Parse `startDate`, `endDate`, `account` from query params
    - Build hledger `print` args with optional `-b`, `-e`, account filter flags
    - Call `hledgerExec` and return result
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 4.3 Implement `POST /api/transactions` in `server/api/transactions.post.ts`
    - Read body as `TransactionInput`
    - Validate: return 400 if `date`, `description`, or `postings` missing; return 400 if fewer than 2 postings
    - Call `addTransaction`, set status 201, return `{ success: true }`
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 4.4 Implement `GET /api/accounts` in `server/api/accounts.get.ts`
    - Call `hledgerExec(['accounts'])` and return result
    - _Requirements: 7.1_

  - [x] 4.5 Write unit tests for API route validation logic
    - Test 400 response for missing required fields on POST /api/transactions
    - Test 400 response for fewer than 2 postings on POST /api/transactions
    - Test that query params are correctly forwarded to hledger for GET routes
    - _Requirements: 6.1, 6.2, 4.2, 4.3, 4.4, 5.2, 5.3, 5.4_

- [x] 5. Checkpoint — Verify API routes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Docker and deployment setup
  - [x] 6.1 Create `Dockerfile` with multi-stage build
    - Stage 1 (build): Node 20 Alpine, `npm ci`, `npm run build`
    - Stage 2 (runtime): Node 20 Alpine, install hledger, copy `.output/`, set `LEDGER_FILE`, `HOST`, `PORT` env vars, expose 3000
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

  - [x] 6.2 Create `docker-compose.yml`
    - Single `app` service building from Dockerfile
    - Map port 3000, mount named volume `journal-data` at `/data`
    - Set `LEDGER_FILE=/data/main.journal` environment variable
    - _Requirements: 8.4_

- [x] 7. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirement acceptance criteria (e.g., 3.1 = Requirement 3, criterion 1)
- Property tests require hledger to be installed in the test environment
- All server utils are plain functions auto-imported by Nitro from `server/utils/`
