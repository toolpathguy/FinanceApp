# FinanceApp (hledger budget app) — project steering

A Nuxt 4 web app that wraps the **hledger** CLI in a YNAB-style budgeting UI.
All accounting logic lives in hledger; the app is a thin layer that runs CLI
commands / writes the journal directly and presents results with Nuxt UI.

This file and its imports auto-load every session opened inside this repo.
Keep it lean — depth lives in the canonical docs linked below.

## Always-on steering
@.claude/steering/product.md
@.claude/steering/tech.md
@.claude/steering/structure.md
@.claude/steering/workflow.md
@.claude/steering/separation-of-concerns.md
@.claude/steering/ai-map-reference.md

## Deep references (read on demand — not auto-loaded)
- Full design doc: `.kiro/steering/hledger-budget-app-design.md` — the living,
  authoritative design (architecture, envelope model, API surface, lessons
  learned). Read it before any non-trivial change.
- Feature specs: `.kiro/specs/<feature>/` — requirements.md, design.md, tasks.md.
