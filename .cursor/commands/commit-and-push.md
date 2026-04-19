# /commit-and-push

Stage, commit, and push the current working changes with a sensible Conventional Commits message. Use this when the user wants to "ship", "save", "commit and push", or otherwise persist their in-progress work to the remote.

## What to do

1. **Inspect the working tree** in parallel (single message, multiple `Shell` calls):
   - `git status --short` — see staged, unstaged, and untracked files.
   - `git diff --stat` and `git diff --cached --stat` — get a high-level shape of changes.
   - `git diff` and `git diff --cached` — read the actual content changes (truncate or sample if very large).
   - `git log --oneline -10` — match the repo's existing commit message style.
   - `git rev-parse --abbrev-ref HEAD` and `git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true` — current branch + whether it tracks an upstream.

2. **Decide what to stage**:
   - Default: stage everything with `git add -A` (includes new + modified + deleted).
   - **Skip / warn** about anything that looks sensitive: `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, `credentials*`, `secrets*`, anything containing obvious tokens. If found, list them and ask the user before staging.
   - **Skip noise** that shouldn't be committed even if untracked: `.worktrees/`, `node_modules/`, build artifacts, OS junk (`.DS_Store`). Mention what you skipped.
   - If the user already had things staged and unstaged separately, respect that intent — only commit what's staged unless they say otherwise.

3. **Draft the commit message** following this repo's convention (see `git log` — Conventional Commits: `type(scope): subject`):
   - **Type**: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `style`, `build`, `ci`.
   - **Scope** (optional): the affected area, e.g. `ui`, `planner`, `executor`, `foundry`. Infer from the changed paths.
   - **Subject**: imperative, lowercase, no trailing period, ≤72 chars. Focus on the *why* / user-visible effect, not a file list.
   - For multi-concern changes, add a short body (blank line, then bullet points). Skip the body for trivial single-purpose commits.
   - **Do not** add `Co-authored-by`, `Generated with`, emoji, or any AI/assistant attribution unless the user explicitly asks.

4. **Commit and push** sequentially:
   - `git add …` (per step 2)
   - `git commit -m "$(cat <<'EOF'` … `EOF` `)"` — always use a heredoc so multi-line messages format correctly.
   - If `HEAD` has no upstream: `git push -u origin HEAD`.
   - Otherwise: `git push`.
   - If the push is rejected (non-fast-forward), **stop** and report — do not force-push, do not pull/rebase, without explicit user consent.

5. **Verify and report**:
   - Run `git status` to confirm the tree is clean.
   - Report: the commit SHA + subject, the branch, and the remote it was pushed to. If the remote is GitHub and `gh` is available, you may include `gh pr view --json url -q .url 2>/dev/null` to surface an existing PR URL — but do **not** create a new PR unless asked.

## Hard rules

- **Never** run destructive git commands (`push --force`, `reset --hard`, `clean -fd`, branch deletion) unless the user explicitly asks.
- **Never** use `--no-verify` to skip hooks. If a pre-commit hook fails, fix the issue and create a **new** commit (do not `--amend` a hook-failed commit — it never landed).
- **Never** `git commit --amend` or rewrite history unless the user explicitly asks. The only narrow exception is when a pre-commit hook auto-modified files during a commit that *succeeded* and those modifications belong in the same commit, AND the commit hasn't been pushed yet.
- **Never** modify `git config`.
- **Never** commit if `git status` shows nothing to commit — say so and stop.
- If the current branch is `main` or `master`, **pause and confirm** with the user before committing/pushing directly.

## Notes

- Match the existing commit style from `git log --oneline` — this repo uses Conventional Commits with optional scope (e.g. `feat(ui): …`, `fix(planner): …`).
- Prefer one focused commit per invocation. If the diff spans clearly unrelated concerns, surface that and ask whether to split before committing.
