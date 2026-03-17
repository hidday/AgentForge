## Plan Review Task

Review the following implementation plan against the issue requirements and constraints.

### Original Issue

- **ID**: {{issue.id}}
- **Title**: {{issue.title}}
- **Description**: {{issue.description}}
- **Labels**: {{issue.labels}}
- **Priority**: {{issue.priority}}

### Plan Under Review (v{{plan.planVersion}})

**Summary**: {{plan.summary}}

**Assumptions**:
{{plan.assumptions}}

**Steps**:
{{plan.steps}}

**Test Plan**: {{plan.testPlan}}

**Confidence**: {{plan.confidence}}

**Open Questions**:
{{plan.openQuestions}}

**Risks**:
{{plan.risks}}

### Constraints

- Required checks: {{constraints.requiredChecks}}
- Max files changed: {{constraints.maxFilesChanged}}
- Max diff lines: {{constraints.maxDiffLines}}
- Forbidden patterns: {{constraints.forbiddenPatterns}}

### Definition of Done

{{definitionOfDone}}

## Instructions

1. Evaluate the plan against the issue requirements
2. Check for completeness, feasibility, and risk coverage
3. Flag unclear or underspecified steps
4. Classify each finding with severity
5. Provide an overall verdict (approved / changes_requested)
6. Produce the structured plan review output
