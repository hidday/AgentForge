## Task

Research best-effort answers to the open questions raised in the plan below. Investigate one question at a time, gather evidence from the issue, plan, and repository, then produce a structured set of researched answers.

### Issue

- **ID**: {{issue.id}}
- **Title**: {{issue.title}}
- **Description**: {{issue.description}}
- **Labels**: {{issue.labels}}
- **Priority**: {{issue.priority}}

### Repository

- **Name**: {{repo.name}}
- **Default Branch**: {{repo.defaultBranch}}
- **Working Branch**: {{repo.workingBranch}}
- **Allowed Paths**: {{repo.allowedPaths}}
- **Protected Paths**: {{repo.protectedPaths}}

### Current Plan (v{{plan.planVersion}})

**Summary**: {{plan.summary}}

**Assumptions**:
{{plan.assumptions}}

**Steps**:
{{plan.steps}}

**Risks**:
{{plan.risks}}

**Test Plan**: {{plan.testPlan}}

**Confidence**: {{plan.confidence}}

{{relatedContextSection}}
{{openQuestionsSection}}

{{humanAnswersSection}}

## Instructions

1. Read the issue and the plan first so you understand what is being built.
2. For each open question listed above, investigate it using the issue, plan, related context, and the repository.
3. Produce one entry per question in the `answers` array using the exact `questionId` value.
4. Assign a `confidence` honestly. Use `unresolved` rather than guessing.
5. Cite concrete `sources` (file paths, identifiers, URLs, plan step IDs) when you rely on them.
6. Write a short `summary` describing your overall findings.
7. Do NOT write code or modify any files. Your output is research only.
