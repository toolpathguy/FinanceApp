---
inclusion: auto
description: High-level architecture and design decisions for the hledger budget app
---

# hledger Budget App — High-Level Design

This is a living design document. Update it as features are built.

## What This App Is

A Nuxt 4 web app that wraps the hledger CLI in a friendly budgeting UI. All accounting logic lives in hledger — the app is a thin layer that executes CLI commands and presents the results using Nuxt UI components.

- Framework: Nuxt 4
- UI: Nuxt UI (not raw Vue components)
- Data: hledger plain-text journal files on disk
- Runtime: Docker Compose — single container with Nuxt + hledger, journal data on a volume

## Architecture

```
Browser (Nuxt UI)  →  Nuxt 4 Server (Nitro)  →  hledger CLI  →  .journal files
```

- The frontend talks to Nitro API routes under `/api/`
- Nitro routes spawn `hledger` child processes with `--output-format json`
- hledger reads/writes `.journal` files — the app never reimplements accounting rules
- Journal file path comes from `LEDGER_FILE` env var or app config

## Key Design Decisions

1. Delegate all accounting to hledger — no custom balance calculations
2. Append-only writes to journal files (no in-place edits)
3. Validate new entries by running them through hledger's parser before saving
4. Use hledger's `--budget` flag for budget vs actuals — no separate budget storage
5. All API responses are typed TypeScript objects parsed from hledger JSON output

## Planned Pages

| Route | Purpose | Status |
|-------|---------|--------|
| `/` | Dashboard — balance overview, recent transactions | Planned |
| `/transactions` | Transaction list with search/filter + add form | Planned |
| `/budget` | Budget vs actuals with progress indicators | Planned |
| `/reports` | Income statement, balance sheet | Planned |
| `/accounts` | Account tree view | Planned |

## API Surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/balances` | Account balances (optional period filter) |
| GET | `/api/transactions` | List transactions with filters |
| POST | `/api/transactions` | Add a new transaction |
| GET | `/api/accounts` | List all account names |
| GET | `/api/budget` | Budget vs actuals report |
| GET | `/api/reports/income-statement` | Income statement |
| GET | `/api/reports/balance-sheet` | Balance sheet |

## Core Server Components

- **HledgerService** — Executes hledger commands, parses JSON output into typed objects
- **JournalManager** — Resolves journal path, appends entries, validates via hledger, creates backups

## Deployment — Docker Compose

The app is designed from the start to run via `docker compose up`.

- Single container: Node image with hledger installed
- Journal data lives on a Docker volume (or bind mount) at `/data/`
- `LEDGER_FILE` env var defaults to `/data/main.journal`
- Nuxt runs in production mode (`node .output/server/index.mjs`)
- Port 3000 exposed by default

```
docker-compose.yml
Dockerfile
```

Key points:
- The Dockerfile installs hledger (via apt or static binary) alongside the Node runtime
- Multi-stage build: build Nuxt in one stage, run in a slim production stage
- Journal files persist across container restarts via the volume
- Users distribute the app by sharing the compose file + optionally a seed journal

## Documentation References

When building this app, use these resources for accurate, up-to-date information:

- **Nuxt 4 / Nuxt framework**: Use the `mcp_nuxt_docs_*` MCP tools (get_documentation_page, list_documentation_pages, etc.) for Nuxt framework docs, modules, deployment guides, and blog posts.
- **Nuxt UI**: Use the `mcp_nuxt_ui_*` MCP tools (get_component, get_component_metadata, list_components, etc.) for component APIs, props, slots, events, theming, and examples.
- **hledger**: No docs MCP available. Use web search and fetch from https://hledger.org as needed for CLI flags, journal format, JSON output structure, and budget directives.

Always prefer MCP tools over web search when available — they return structured, current data.

## Conventions

- Nuxt UI components for all UI (UTable, UCard, UForm, UModal, UProgress, etc.)
- Composables for data fetching (`useBalances`, `useTransactions`, `useBudget`, `useAccounts`)
- Server routes in `server/api/`
- Shared types in a `types/` directory
- hledger service logic in `server/utils/`
