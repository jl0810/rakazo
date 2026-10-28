# Agent Guidelines

## Two-machine sync workflow

This repo is developed across two Macs via GitHub. Follow this exactly.

### Before starting work
- `git fetch` then `git pull` to get the latest from origin.
- If a `wip/*` branch exists for the current task, check it out:
  `git checkout wip/<branch>`.

### When stopping or finishing a session
- Commit all changes (even if incomplete) to a `wip/<date>` branch and push:
  ```
  git checkout -b wip/$(date +%F)   # only if not already on a wip branch
  git add -A
  git commit --no-verify -m "wip: <what you did>"
  git push -u origin HEAD
  ```
- Never leave uncommitted changes when finishing a session.
- Never push directly to main unless the work is complete.

### When work is complete
- Squash-merge the wip branch into main with a real commit message:
  ```
  git checkout main
  git pull
  git merge --squash wip/<branch>
  git commit -m "<descriptive message>"   # no --no-verify; main must pass gates
  git push
  git branch -d wip/<branch>
  git push origin --delete wip/<branch>
  ```

### Deployment
There is no CI/CD on GitHub. Dokploy watches this repo and auto-deploys when
`main` is pushed. Pushing `wip/*` branches is safe — Dokploy ignores them.
`main` is the staging branch. Every push to it auto-deploys the app, and the
QA & merge routine squash-merges PRs into it once they pass its full review
(clean install, typecheck, lint, tests, both Husky hooks). A merge to `main` is
a staging release, not a final sign-off: a bad one is fixed by a revert PR.

### Husky hooks
Before committing, read `.husky/pre-commit` (and `.husky/pre-push`,
`.husky/commit-msg` if present) to understand what gates will run. If the hook
calls `../platform/scripts/hooks/*`, read those too — the real checks are
centralized there. `--no-verify` is for wip commits only; never use it on main.

### Never
- Force-push to main.
- Commit secrets or `.env` files (they are gitignored; keep them out).
- Leave uncommitted changes when finishing a session.
- Use `--no-verify` on commits to main.

---

# AGENTS.md

- This is a public repository: assume all tracked content and diffs are public. Never commit secrets, `.env` files, private URLs, personal/customer data, or real production data; use fake placeholders. Review `git status` and the staged diff before committing, and never force-add ignored files. If private data appears, stop and alert the maintainer.
- Rakazo targets web, Electron desktop, and Expo mobile; Electron hosts the web UI. Consider every surface when changing features or contracts.
- Prefer shared packages for domain logic, contracts, API behavior, and reusable UI. Keep genuinely native navigation, storage, permissions, and interactions platform-specific.
- Treat auth, secret handling, sandbox boundaries, host commands, and integrations as security-sensitive. Keep tests deterministic and offline by default.
- After creating a pull request, stay with it until CI and automated review bots have finished. Poll checks, reviews, review threads, and PR comments at roughly 60-second intervals; passing checks alone do not mean the review is complete. Address every actionable issue, push the fixes, and repeat the review cycle until no actionable feedback remains. Do not merge while review bots are still pending or review issues remain unresolved.
