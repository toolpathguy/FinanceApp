# Structure

```
app.vue, app.config.ts, nuxt.config.ts   # root: UApp shell, UI colors, modules
assets/css/main.css                       # Tailwind theme, font, palette
components/                               # AccountRegister.vue, SimplifiedTransactionForm.vue
layouts/default.vue                       # UDashboardGroup + sidebar + account tree
pages/                                    # index, budget, reports, settings, accounts/[...path]
composables/                             # useAccounts/Balances/Transactions/Budget/Reports (data fetch)
utils/                                    # pure helpers (formatAmount, buildAccountTree, …) + tests
types/                                    # hledger.ts, api.ts, ui.ts
server/
  api/                                   # Nitro routes: <name>.<method>.ts (accounts, budget/*, journal/*)
  utils/                                 # hledger.ts, journalWriter.ts (auto-imported)
test-data/sample.journal                 # multi-month fixture
.kiro/{steering,specs}/                  # canonical design doc + feature specs
```

## Conventions
- **Data fetching** → composables in `composables/`. **Server logic** → `server/utils/`.
  **API** → `server/api/` as `<name>.<method>.ts`. **Shared types** → `types/`.
- **Tests live beside source**: `*.test.ts` (unit) and `*.property.test.ts`
  (fast-check), with API tests under `server/**/__tests__/`.
- Mock Nitro globals in route tests with `vi.stubGlobal()`.
- Pure functions for utils — easy to property-test.
- UTree leaf nodes need `children: undefined` (not `[]`) to be selectable.
- UCard slots are `header` / default / `footer` — there is no `#body`.

Full annotated tree with per-file responsibilities is in
`.kiro/steering/hledger-budget-app-design.md`.
