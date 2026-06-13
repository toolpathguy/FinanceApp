# Separation of Concerns — FinanceApp

Enforce these layer boundaries strictly. Data flows top-to-bottom; never skip or
invert layers.

```
Pages / Components  →  Composables  →  server/api (Nitro)  →  server/utils  →  hledger CLI / .journal
   UI rendering        data fetching     HTTP glue            engine adapter     accounting engine
                                                              + journal writer
        └── utils/ (pure helpers) ──┘                    types/ (shared interfaces)
```

## Layer rules
- **Pages / Components** (`pages/`, `components/`): UI only. Fetch through
  composables; render with Nuxt UI. Never call `/api/*` directly, never import
  from `server/`, never format hledger data inline (use `utils/`).
- **Composables** (`composables/`): thin data-fetch clients over `/api/*`
  (`useFetch`/`$fetch`), returning reactive state. No business logic, no
  accounting math.
- **utils/** (`utils/`): **pure functions** only — no I/O, no `fetch`, no `fs`.
  Account-name shaping, amount formatting, form validation, posting derivation,
  register/tree building. Easy to property-test; this is where presentation logic
  lives.
- **server/api/** (`server/api/<name>.<method>.ts`): parse/validate request,
  call a `server/utils` function, transform the result, return JSON. No direct
  `child_process`/`fs`, no hledger command strings inline.
- **server/utils/** (`hledger.ts`, `journalWriter.ts`): the ONLY place that
  spawns hledger or touches the journal file. `hledgerExec`/`hledgerExecText`
  for reads; `validateTransaction`/`formatTransaction`/`appendTransaction` for
  writes. Auto-imported by Nitro.
- **types/** (`hledger.ts`, `api.ts`, `ui.ts`): shared interfaces. Server raw
  hledger JSON is transformed to these before crossing into the API response.

## Red flags
- A component calling `$fetch('/api/...')` directly → use a composable.
- A composable computing "Ready to Assign" or running balances → move to `utils/`
  (pure) or `server/api` (if it needs hledger).
- An API route building an hledger arg string or calling `fs.appendFile` inline →
  delegate to `server/utils` (`hledgerExec*` / `appendTransaction`).
- Accounting math (balances, deltas) reimplemented in app code → **delegate to
  hledger**; the app never recomputes what the engine owns.
- Account-name prefix stripping / amount formatting inlined in a `.vue` file →
  use the `utils/` helper (`stripAccountPrefix`, `formatAmount`).

## Data integrity preferences
- **Delegate accounting to hledger** — no custom balance calculations in app code.
- **Writes go through the direct journal writer** (`appendTransaction`), not
  `hledger add`. Deletes edit the journal file by transaction index.
- **Envelopes are real hledger sub-accounts** under `assets:checking:budget:*` —
  every assignment/transfer is a balanced double-entry transaction.
- **Hidden envelopes must be zero-balance before hiding** — never let money
  vanish from the budget view.
- **Windows CRLF:** parse hledger text output with `split(/\r?\n/)` + trim.
- **No `= $0.00` balance assertion** in single-envelope budget assigns — hledger
  rejects the journal.
