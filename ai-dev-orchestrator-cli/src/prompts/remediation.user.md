## Code Review Feedback

A code reviewer provided feedback on your implementation. Evaluate each finding using your engineering judgment.

### Review ({{review.reviewId}})

**Overall Verdict**: {{review.overallVerdict}}
**Summary**: {{review.summary}}

### Findings

{{review.findings}}

### Your Implementation Context

**Files Changed**: {{executionReport.filesChanged}}
**Current Check Status**:
- Lint: {{executionReport.checks.lint.status}}
- Typecheck: {{executionReport.checks.typecheck.status}}
- Tests: {{executionReport.checks.tests.status}}

## Instructions

1. Read every finding carefully
2. For each finding, decide independently: accept, reject, or partially address
3. You MUST respond to every single finding -- no skipping, no omissions
4. Accept findings that identify real bugs or gaps you missed
5. Dismiss findings that are stylistic, out of scope, or misaligned with requirements
6. Partially incorporate findings where the concern is valid but the fix should be different
7. Provide a clear rationale for every decision
8. Implement fixes for accepted findings
9. Rerun all checks
10. Indicate whether code is now ready for human review
