---
inclusion: always
---
<!------------------------------------------------------------------------------------
   Add rules to this file or a short description and have Kiro refine them for you.
   
   Learn about inclusion modes: https://kiro.dev/docs/steering/#inclusion-modes
-------------------------------------------------------------------------------------> 
# Git Branching and Merge Workflow

## Rules

1. NEVER commit directly to `main`. All work MUST happen on a branch.

2. Before starting any new work, create a branch off `main` using one of these prefixes:
   - `feat/` — new features or functionality
   - `chore/` — cleanup, refactoring, UI polish, dependency updates
   - `fix/` — bug fixes

   Example: `git checkout -b feat/barcode-improvements`

3. Make as many commits as needed on the branch. Use clear, descriptive commit messages.

4. When the work is complete and ready to merge:
   - Switch to `main`: `git checkout main`
   - Squash merge the branch: `git merge --squash <branch-name>`
   - Commit with a single summary message describing all changes: `git commit -m "..."`

5. Do NOT use regular merge (`git merge` without `--squash`). Always squash.

6. Do NOT rebase onto main. Use squash merge only.

7. If the user asks to "commit" while on a feature branch, commit to the current branch. Only merge to `main` when the user explicitly asks to merge, or says they are done with the branch.
