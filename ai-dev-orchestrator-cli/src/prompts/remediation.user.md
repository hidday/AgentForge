## Remediation Task

Address the following review findings.

### Review ({{review.reviewId}})

**Overall Verdict**: {{review.overallVerdict}}
**Summary**: {{review.summary}}

### Findings

{{review.findings}}

### Current Execution Context

**Files Changed**: {{executionReport.filesChanged}}
**Current Check Status**:
- Lint: {{executionReport.checks.lint.status}}
- Typecheck: {{executionReport.checks.typecheck.status}}
- Tests: {{executionReport.checks.tests.status}}

## Instructions

1. Address each finding explicitly
2. For each finding, classify your response as: accepted, rejected, or partially_addressed
3. Implement fixes for accepted findings
4. Provide clear rationale for rejected findings
5. Rerun all checks
6. Indicate whether code is now ready for human review
