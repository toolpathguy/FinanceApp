# AI Map Reference

Before searching the codebase with grep/find, consult **`AI-MAP.md`** at the
project root. It contains the tech stack, run/build/test commands, page inventory,
API surface, server-util and pure-util locations, data flow, and known quirks.

For the full design rationale (envelope model, transaction mappings, lessons
learned), read `.kiro/steering/hledger-budget-app-design.md`.

## Living document
`AI-MAP.md` reflects what the codebase IS, not a frozen plan. If reality diverges
from the map, **update the map** — don't treat it as gospel.

## When to update the map
After any task that changes the project's shape, update `AI-MAP.md`. Specifically when you:
- Add, rename, or remove pages, components, or `/api/*` routes
- Add or change composables, server utils, or pure utils
- Change run/build/test commands or the tech stack (deps)
- Discover a new quirk or resolve an existing one

Keep updates lightweight — a one-line table row or bullet is enough. Don't let
map maintenance become a bottleneck.

## Sub-agent instructions
When delegating, tell sub-agents: "Consult `AI-MAP.md` at the project root for
structure, stack, and route/util locations. Do NOT run git commands. Do NOT
modify `AI-MAP.md` — the main agent owns map updates." Sub-agents may READ the
map but MUST NOT write to it; the main agent updates it in one coherent pass
after delegated work concludes.
