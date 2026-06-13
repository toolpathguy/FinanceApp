# Workflow (git + process)

Mirrors `.kiro/steering/Git Branching and Merge Workflow.md` (inclusion: always).

## Branching
- **NEVER commit directly to `main`.** All work happens on a branch.
- Branch off `main` with a prefix: `feat/` (features), `fix/` (bug fixes),
  `chore/` (cleanup, refactor, deps, UI polish). E.g. `feat/barcode-improvements`.
- Make as many commits as needed on the branch, with clear messages.
- Scope each branch to one logical unit. When its scope is done, push + open a PR
  before starting the next branch — don't pile unrelated work onto a finished one.
- Before starting new work, check `git branch --show-current`; if on the wrong
  branch, switch to `main` first, then create the new branch.

## Commit timing — batch over noise
- Don't commit/push after every small change. Let iterative tweaks accumulate as
  unstaged work; commit at natural completion points (feature works end-to-end,
  user says "ship it", a spec task is fully done, or switching context).
- When in doubt, don't commit. Batch related changes into one meaningful commit.

## Merging — PRs only (NO local merge)
- Merge only when I explicitly ask / say I'm done / say "create a PR".
- **Push then open a PR on GitHub targeting `main`** (GitHub MCP, or `gh` CLI if
  MCP isn't connected). PR title = conventional commit (`feat:`/`fix:`/`chore:`).
- **PR body MUST start with `Fixes #<n>` or `Relates to #<n>`** — search open
  issues to find the ticket. Never `git merge`/`--squash`/rebase against `main`.
- **Never auto-push.** Local commits at completion points are fine; pushing is a
  deliberate action I ask for. "Commit" on a feature branch = commit there only.

## Subagents / delegated tasks
- Subagents MUST NOT run any git command (no branch, checkout, add, commit,
  stash). They write files to the working directory only.
- The orchestrator (main agent) owns all git operations. When delegating,
  include: "Do NOT run git commands or create branches; write files directly."

## .gitignore hygiene
- Never commit `node_modules/`, `.nuxt/`, `.output/`, `config/`. Verify
  `.gitignore` before any `git add -A`/`git add .`.

## Verification
- After a change, state how it was checked (tests run, app launched) — and say
  so plainly if it wasn't.
