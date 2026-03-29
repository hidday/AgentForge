## Task

Implement the following approved plan.

### Approved Plan (v{{plan.planVersion}})

**Summary**: {{plan.summary}}

**Steps**:
{{plan.steps}}

**Test Plan**: {{plan.testPlan}}

### Repository Context

- **Repo**: {{repo.name}}
- **Working Branch**: {{repo.workingBranch}}
- **Allowed Paths**: {{repo.allowedPaths}}
- **Protected Paths**: {{repo.protectedPaths}}

### Constraints

- Required checks: {{constraints.requiredChecks}}
- Max files changed: {{constraints.maxFilesChanged}}
- Max diff lines: {{constraints.maxDiffLines}}
- Forbidden patterns: {{constraints.forbiddenPatterns}}

## Instructions

1. Implement each plan step in order
2. Stay within allowed paths
3. Run lint, typecheck, and test checks
4. List all changed files
5. Do NOT commit, push, or create branches -- the orchestrator handles Git operations
6. Produce the structured execution report
