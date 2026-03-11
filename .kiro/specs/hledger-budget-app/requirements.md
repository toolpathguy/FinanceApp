# Requirements Document

## Introduction

This document defines the requirements for the hledger Budget App — Basics phase. The app is a Nuxt 4 + Nuxt UI web application that wraps the hledger CLI to provide a friendly budgeting interface. All accounting logic — including formatting, validation, and writing transactions — is delegated to hledger. The app never touches the journal file directly. This phase covers project scaffolding, the hledger utility module, shared types, four API routes, and Docker Compose setup.

## Glossary

- **App**: The Nuxt 4 web application that wraps hledger CLI functionality
- **Nitro_Server**: The Nuxt server engine that handles API routes and spawns hledger processes
- **Hledger_CLI**: The hledger command-line tool used for all accounting operations (reads, writes, validation)
- **Journal_File**: A plain-text hledger journal file stored on disk containing financial transactions
- **Transaction**: A dated financial entry consisting of a description and two or more postings
- **Posting**: A single line within a transaction specifying an account and optionally an amount
- **Balance_Report**: A report of account balances produced by hledger's `bal` command
- **Transaction_Writer**: The `addTransaction` function that pipes input to `hledger add` via stdin
- **Path_Resolver**: The `resolveJournalPath` function that determines the journal file location from environment variables

## Requirements

### Requirement 1: Journal Path Resolution

**User Story:** As a developer deploying the app, I want the journal file path to be configurable via environment variable, so that I can run the app in different environments without code changes.

#### Acceptance Criteria

1. WHEN the `LEDGER_FILE` environment variable is set, THE Path_Resolver SHALL return its value as the journal file path
2. WHEN the `LEDGER_FILE` environment variable is not set, THE Path_Resolver SHALL return `/data/main.journal` as the default path
3. THE Path_Resolver SHALL return a non-empty string for all possible environment configurations

### Requirement 2: Hledger Command Execution

**User Story:** As a server component, I want to execute hledger CLI commands and receive parsed JSON output, so that API routes can return structured data to the frontend.

#### Acceptance Criteria

1. WHEN a valid hledger command is executed, THE Nitro_Server SHALL spawn an hledger process with the provided arguments, the resolved journal file path, and JSON output format
2. WHEN the hledger process exits with code 0, THE Nitro_Server SHALL parse the stdout as JSON and return the result
3. IF the hledger process exits with a non-zero code, THEN THE Nitro_Server SHALL throw an error containing the stderr output

### Requirement 3: Transaction Persistence via hledger add

**User Story:** As a user, I want new transactions written to my journal exclusively by hledger, so that formatting, validation, and file writes are all handled by the accounting tool.

#### Acceptance Criteria

1. WHEN a valid `TransactionInput` is provided, THE Transaction_Writer SHALL pipe the date, description, account/amount pairs, end-of-postings marker, save confirmation, and quit signal to `hledger add` via stdin
2. WHEN `hledger add` exits with code 0, THE Transaction_Writer SHALL resolve successfully and the transaction SHALL appear in the journal file
3. IF `hledger add` exits with a non-zero code, THEN THE Transaction_Writer SHALL throw an error containing stderr and the journal file SHALL be unchanged
4. THE App SHALL NOT directly write to, append to, or modify the journal file — only hledger processes may modify it

### Requirement 4: Balance API

**User Story:** As a frontend component, I want to fetch account balances with optional filters, so that I can display balance summaries on the dashboard.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/balances` without query parameters, THE Nitro_Server SHALL return the full balance report from hledger
2. WHEN a `period` query parameter is provided, THE Nitro_Server SHALL pass it to hledger as a `-p` flag
3. WHEN an `account` query parameter is provided, THE Nitro_Server SHALL pass it to hledger as an account filter argument
4. WHEN a `depth` query parameter is provided, THE Nitro_Server SHALL pass it to hledger as a `--depth` flag

### Requirement 5: Transaction List API

**User Story:** As a frontend component, I want to fetch transactions with optional date and account filters, so that I can display a searchable transaction list.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/transactions` without query parameters, THE Nitro_Server SHALL return all transactions from hledger
2. WHEN a `startDate` query parameter is provided, THE Nitro_Server SHALL pass it to hledger as a `-b` (begin) flag
3. WHEN an `endDate` query parameter is provided, THE Nitro_Server SHALL pass it to hledger as an `-e` (end) flag
4. WHEN an `account` query parameter is provided, THE Nitro_Server SHALL pass it to hledger as an account filter argument

### Requirement 6: Transaction Creation API

**User Story:** As a user, I want to add new transactions through the API, so that I can record financial entries from the web interface.

#### Acceptance Criteria

1. WHEN a POST request to `/api/transactions` is missing the `date`, `description`, or `postings` fields, THE Nitro_Server SHALL return a 400 status with the message "Missing required fields"
2. WHEN a POST request to `/api/transactions` contains fewer than 2 postings, THE Nitro_Server SHALL return a 400 status with the message "At least 2 postings required"
3. WHEN a valid POST request is made to `/api/transactions`, THE Nitro_Server SHALL persist the transaction via `hledger add` and return a 201 status with `{ success: true }`

### Requirement 7: Accounts API

**User Story:** As a frontend component, I want to fetch the list of all account names, so that I can populate account selectors and display the account tree.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/accounts`, THE Nitro_Server SHALL return the list of account names from hledger

### Requirement 8: Docker Deployment

**User Story:** As a developer, I want to run the app via Docker Compose with a single command, so that setup is reproducible and includes hledger.

#### Acceptance Criteria

1. THE Dockerfile SHALL use a multi-stage build with Node 20 Alpine for both build and runtime stages
2. THE Dockerfile SHALL install hledger in the runtime stage
3. THE Dockerfile SHALL set `LEDGER_FILE`, `HOST`, and `PORT` environment variables with default values
4. THE docker-compose.yml SHALL define a single service that builds from the Dockerfile, maps port 3000, and mounts a named volume at `/data`
5. WHEN the container starts, THE App SHALL serve on the configured host and port using the built Nuxt output

### Requirement 9: Shared Type Definitions

**User Story:** As a developer, I want shared TypeScript types for hledger JSON output and API request shapes, so that the frontend and server code use consistent data structures.

#### Acceptance Criteria

1. THE App SHALL define `HledgerAmount`, `HledgerPosting`, `HledgerTransaction`, `HledgerBalanceRow`, and `HledgerBalanceReport` types that mirror hledger's JSON output structure
2. THE App SHALL define `TransactionInput`, `PostingInput`, `BalanceQuery`, and `TransactionQuery` types for API request shapes
3. THE App SHALL store type definitions in a shared `types/` directory accessible to both server and client code
