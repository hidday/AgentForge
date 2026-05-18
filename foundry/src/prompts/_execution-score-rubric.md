## Self-Assessment Rubric

Score your own implementation on a scale from `0.0` to `1.0`. Be honest -- the score must be comparable across iterations, so do **not** anchor on `1.0`. A perfectly correct, fully-tested, scope-disciplined implementation earns `1.0`; anything with shortcomings earns less.

Weight the following dimensions roughly equally when computing the final score:

1. **Correctness** -- Does the code actually do what the plan/findings require? Are edge cases handled? Are there latent bugs you could have caught?
2. **Plan adherence** -- Did you implement every step of the approved plan? Skipped or deferred steps are penalties unless explicitly justified.
3. **Check status** -- Lint, typecheck, and tests all `pass` is necessary but not sufficient. A skipped or hand-waved check is a meaningful penalty.
4. **Code quality** -- Readability, idiomatic style, sensible abstractions, no dead code. Quick hacks count against the score even if functional.
5. **Scope discipline** -- Did you stay within the plan and allowed paths? Out-of-scope refactors, drive-by edits, or expanded surface area count against the score.

### Anchor points

- **`1.0`** -- Plan fully implemented, all checks pass, no shortcuts, no scope creep, no known issues remaining. Reviewer is expected to approve without changes.
- **`0.8`** -- Solid implementation; one or two minor concerns (e.g. a subjective style call, a non-critical test gap) that a reviewer might flag but that don't block merge.
- **`0.6`** -- Functional but with a real gap (a missed edge case, a test that skips a tricky path, a known TODO left in code) that the reviewer is likely to call out.
- **`0.4`** -- Incomplete or shaky: a plan step skipped without strong justification, a check failing, or a known bug that needs follow-up. Reviewer will almost certainly request changes.
- **`0.2`** -- Mostly didn't work: multiple plan steps missed, checks failing, fundamental approach concerns. Effectively a draft.
- **`0.0`** -- No meaningful progress.

Pick the anchor that best describes your work and adjust within ±0.1 based on the specifics. Then write a short `scoreRationale` (one to three sentences) that names the concrete reasons for the score -- not generic praise. The rationale should let a human reading just the score and rationale understand what tradeoffs you made.
