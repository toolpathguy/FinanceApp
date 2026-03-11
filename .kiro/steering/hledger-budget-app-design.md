---
inclusion: auto
description: High-level architecture and design decisions for the hledger budget app
---

# hledger Budget App — High-Level Design

This is a living design document. Update it as features are built.

## What This App Is

A Nuxt 4 web app that wraps the hledger CLI in a friendly budgeting UI. All accounting logic lives in hledger — the app is a thin layer that executes CLI commands and presents the results using Nuxt UI components.

- Framework: Nuxt 4 (nuxt ^3.16.0 with compatibilityDate 2025-01-01)
- UI: Nuxt UI v3 (@nuxt/ui ^3.0.0) — not raw HTML or hand-rolled Vue components
- Data: hledger plain-text journal files on disk
- Runtime: Docker Compose — single container with Nuxt + hledger, journal data on a volume
- Testing: Vitest + fast-check for property-based testing

## Architecture

```
Browser (Nuxt UI)  →  Nuxt 4 Server (Nitro)  →  hledger CLI  →  .journal files
```

- The frontend talks to Nitro API routes under `/api/`
- Nitro routes spawn `hledger` child processes with `-O json`
- hledger reads/writes `.journal` files — the app never reimplements accounting rules
- Journal file path comes from `LEDGER_FILE` env var (default: `/data/main.journal`)
- Server utils in `server/utils/` are auto-imported by Nitro — no manual imports needed

## Project Structure (Current)

```
├── app.vue                          # Minimal <NuxtPage /> shell
├── nuxt.config.ts                   # @nuxt/ui module, devtools
├── tsconfig.json                    # Standalone TS config (ES2022 target, node types)
├── vitest.config.ts                 # Vitest with esbuild tsconfigRaw workaround
├── package.json                     # nuxt, @nuxt/ui, vitest, fast-check, @types/node
├── Dockerfile                       # Multi-stage: Node 20 Alpine + hledger
├── docker-compose.yml               # Single app service, journal-data volume
├── types/
│   ├── hledger.ts                   # HledgerAmount, HledgerPosting, HledgerTransaction, etc.
│   └── api.ts                       # TransactionInput, PostingInput, BalanceQuery, etc.
├── server/
│   ├── utils/
│   │   ├── hledger.ts               # resolveJournalPath, hledgerExec, addTransaction
│   │   └── __tests__/
│   │       └── hledger.test.ts      # Property tests (P1, P2-skipped, P3, P4)
│   └── api/
│       ├── balances.get.ts          # GET /api/balances
│       ├── transactions.get.ts      # GET /api/transactions
│       ├── transactions.post.ts     # POST /api/transactions
│       ├── accounts.get.ts          # GET /api/accounts
│       └── __tests__/
│           └── api-routes.test.ts   # Unit tests with mocked Nitro globals
└── .kiro/
    ├── specs/hledger-budget-app/    # Spec files (requirements, design, tasks)
    └── steering/                    # This file + git workflow rules
```

## Key Design Decisions

1. Delegate all accounting to hledger — no custom balance calculations
2. Append-only writes to journal files (no in-place edits)
3. All writes go through `hledger add` via stdin — the app NEVER writes to the journal file directly
4. Use hledger's `--budget` flag for budget vs actuals — no separate budget storage
5. All API responses are typed TypeScript objects parsed from hledger JSON output
6. Server utils are plain exported functions (no classes) — Nitro auto-imports from `server/utils/`

## Known Issues & Lessons Learned

### hledger add stdin behavior
`hledger add` in interactive/stdin mode does NOT reject unbalanced transactions. When given two postings with explicit amounts that don't sum to zero, it silently zeroes them out and exits 0. This means:
- Property 2 (reject invalid input) is skipped — the spec assumed hledger would reject, but it doesn't
- Input validation for balanced amounts must happen in the app layer if needed, not rely on hledger add

### TypeScript setup without nuxt prepare
The `.nuxt/tsconfig.json` doesn't exist until `nuxt prepare` or `nuxt dev` runs. The standalone `tsconfig.json` uses `ES2022` target with `@types/node` so the IDE works without running nuxt prepare first. The vitest config uses `esbuild: { tsconfigRaw: '{}' }` to avoid the same issue during test runs.

### Nitro auto-imports in tests
API route handlers use Nitro auto-imports (`defineEventHandler`, `getQuery`, `readBody`, `createError`, `setResponseStatus`, `hledgerExec`, `addTransaction`). These show as IDE errors until `nuxt prepare` generates type declarations. Tests mock these globals with `vi.stubGlobal()`.

## Planned Pages

| Route | Purpose | Status |
|-------|---------|--------|
| `/` | Dashboard — balance overview, recent transactions | Planned |
| `/transactions` | Transaction list with search/filter + add form | Planned |
| `/budget` | Budget vs actuals with progress indicators | Planned |
| `/reports` | Income statement, balance sheet | Planned |
| `/accounts` | Account tree view | Planned |

## API Surface

| Method | Path | Purpose | Status |
|--------|------|---------|--------|
| GET | `/api/balances` | Account balances (optional period, account, depth filters) | Done |
| GET | `/api/transactions` | List transactions (optional startDate, endDate, account filters) | Done |
| POST | `/api/transactions` | Add a new transaction (validates required fields + 2+ postings) | Done |
| GET | `/api/accounts` | List all account names | Done |
| GET | `/api/budget` | Budget vs actuals report | Planned |
| GET | `/api/reports/income-statement` | Income statement | Planned |
| GET | `/api/reports/balance-sheet` | Balance sheet | Planned |

## Core Server Utils — `server/utils/hledger.ts`

Three plain functions, auto-imported by Nitro:

- `resolveJournalPath()` — returns `LEDGER_FILE` env var or `/data/main.journal`
- `hledgerExec(args)` — spawns hledger with args + `-f <path> -O json`, parses JSON stdout, throws on non-zero exit
- `addTransaction(input)` — pipes stdin to `hledger add`: date, description, account/amount pairs, `.` (end), `y` (confirm), `.` (quit). Commodity defaults to `$`.

## Deployment — Docker Compose

- Single container: Node 20 Alpine with hledger installed via `apk`
- Multi-stage build: build Nuxt in stage 1, copy `.output/` to slim runtime stage
- Journal data on named volume `journal-data` at `/data/`
- `LEDGER_FILE=/data/main.journal`, `HOST=0.0.0.0`, `PORT=3000`
- Run with `docker compose up`

## Documentation References

When building this app, use these resources for accurate, up-to-date information:

- **Nuxt 4 / Nuxt framework**: Use the `mcp_nuxt_docs_*` MCP tools (get_documentation_page, list_documentation_pages, etc.)
- **Nuxt UI**: Use the `mcp_nuxt_ui_*` MCP tools (get_component, get_component_metadata, list_components, etc.)
- **hledger**: No docs MCP available. Use web search and fetch from https://hledger.org as needed

Always prefer MCP tools over web search when available.

## Conventions

- Nuxt UI components for all UI (UTable, UCard, UForm, UModal, UProgress, etc.)
- Composables for data fetching (`useBalances`, `useTransactions`, `useBudget`, `useAccounts`)
- Server routes in `server/api/`
- Shared types in `types/` directory
- hledger service logic in `server/utils/`
- Tests alongside source in `__tests__/` directories
- Property-based tests with fast-check, unit tests with vitest
- Mock Nitro globals with `vi.stubGlobal()` for API route tests
