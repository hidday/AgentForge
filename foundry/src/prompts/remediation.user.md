## Code Review Feedback

A code reviewer provided feedback on your implementation. Evaluate each finding using your engineering judgment.

### Review ({{review.reviewId}})

**Overall Verdict**: {{review.overallVerdict}}
**Summary**: {{review.summary}}

### Findings

{{review.findings}}

### Your Implementation Context

**Prior Execution Version**: v{{prevExecutionVersion}}
**Prior Self-Assessed Score**: {{executionReport.score}}
**Prior Score Rationale**: {{executionReport.scoreRationale}}
**Files Changed**: {{executionReport.filesChanged}}
**Current Check Status**:
- Lint: {{executionReport.checks.lint.status}}
- Typecheck: {{executionReport.checks.typecheck.status}}
- Tests: {{executionReport.checks.tests.status}}

## Git Context

You are working in an **isolated Git worktree** on a dedicated branch. Do NOT switch branches, commit, or push. The orchestrator handles all Git operations.

## Instructions

1. Read every finding carefully
2. For each finding, decide independently: accept, reject, or partially address
3. You MUST respond to every single finding -- no skipping, no omissions
4. Accept findings that identify real bugs or gaps you missed
5. Dismiss findings that are stylistic, out of scope, or misaligned with requirements
6. Partially incorporate findings where the concern is valid but the fix should be different
7. Provide a clear rationale for every decision
8. Implement fixes for accepted findings
9. Rerun all checks (lint, typecheck, tests)
10. Produce a new `executionReport` describing the **post-remediation** state -- you own this summary now, just as the original executor owned v{{prevExecutionVersion}}. Score the new state honestly using the rubric; set `executionVersion` to {{nextExecutionVersion}}.
11. Indicate whether code is now ready for human review
