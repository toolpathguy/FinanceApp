# Tech

## Stack
- **Framework:** Nuxt 4 (`nuxt ^4.3.1`), `compatibilityDate: 2025-01-01`.
- **UI:** Nuxt UI v4.5.1 (`@nuxt/ui`) — Dashboard components (UDashboardGroup,
  UDashboardSidebar, UDashboardPanel, UTable, UCard, UModal, UTree, etc.).
- **Language:** TypeScript (`strict`, `noUncheckedIndexedAccess` via Nuxt tsconfig).
- **Testing:** Vitest + fast-check (property-based). Tests live beside source.
- **Accounting engine:** hledger CLI + plain-text `.journal` files.
- **Theme:** primary green, neutral zinc, Public Sans font.

## Commands
- `npm run dev` — dev server at http://localhost:3000
- `npm run test` — `vitest run`
- `npm run build` / `npm run preview`
- Typecheck: `npx nuxi typecheck` (root tsconfig MUST extend `./.nuxt/tsconfig.json`)

## Architecture
`Browser (Nuxt UI) → Nitro API routes (/api/*) → hledger CLI / direct journal writer → .journal`
- New transactions go through the **direct journal writer**
  (`server/utils/journalWriter.ts`: validate → format → `fs.appendFile`), NOT
  `hledger add`. Deletes edit the journal file directly by index.
- hledger reads via `hledgerExec` (`-O json`) or `hledgerExecText` (the
  `accounts` command has no JSON output). Raw JSON is transformed server-side.
- Journal path from `LEDGER_FILE` env (default `test-data/sample.journal`).
- Server utils in `server/utils/` are Nitro auto-imported.

## Platform / gotchas
- **Windows:** hledger emits CRLF — parse with `split(/\r?\n/)` + trim, or `\r`
  leaks into account names (`%0D` in URLs).
- Requires hledger installed locally (`winget install simonmichael.hledger`).
- Don't add `= $0.00` balance assertions in single-envelope budget assigns —
  hledger rejects the journal. (See design doc "Lessons Learned".)

## Docs
- Nuxt 4 / Nuxt UI: prefer the project's Nuxt MCP doc tools when available.
- hledger: https://hledger.org + web search.
