## Review Task

Review the following implementation against the issue, plan, and checks.

### Original Issue

- **ID**: {{issue.id}}
- **Title**: {{issue.title}}
- **Description**: {{issue.description}}

### Approved Plan (v{{plan.planVersion}})

**Summary**: {{plan.summary}}

**Steps**:
{{plan.steps}}

### Execution Report

**Summary**: {{executionReport.summary}}
**Files Changed**: {{executionReport.filesChanged}}
**Checks**:
- Lint: {{executionReport.checks.lint.status}} — {{executionReport.checks.lint.details}}
- Typecheck: {{executionReport.checks.typecheck.status}} — {{executionReport.checks.typecheck.details}}
- Tests: {{executionReport.checks.tests.status}} — {{executionReport.checks.tests.details}}

### PR Diff

```
{{diff}}
```

## Instructions

1. Review the diff against the issue and plan
2. Check for correctness, edge cases, security, maintainability, test gaps
3. Classify each finding with severity (blocker/important/suggestion/nit)
4. Provide an overall verdict
5. Produce the structured review output
