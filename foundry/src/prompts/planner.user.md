## Task

Create an implementation plan for the following issue.

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

### Constraints

- Required checks: {{constraints.requiredChecks}}
- Max files changed: {{constraints.maxFilesChanged}}
- Max diff lines: {{constraints.maxDiffLines}}
- Forbidden patterns: {{constraints.forbiddenPatterns}}
- Must not touch: {{constraints.mustNotTouch}}

### Definition of Done

{{definitionOfDone}}

{{relatedContextSection}}
{{priorSkillsSection}}
## Instructions

1. Analyze the issue thoroughly
2. State your assumptions explicitly
3. List any open questions (mark which ones block execution)
4. Identify risks
5. Break the implementation into clear steps
6. Define a test plan
7. Provide a confidence score
8. Write a requirements traceability paragraph correlating the issue requirements with your plan steps

**Preserve supplied detail.** The issue description above may already contain a detailed, pre-approved plan (e.g. one shaped in Claude Code or Cursor). Do NOT omit, summarize away, or override the explicit details, decisions, and guidelines it provides — carry them through into your plan steps and assumptions. If the description contains an authoritative-plan fence (`===== BEGIN AUTHORITATIVE PLAN ... =====`), follow "Handling an Authoritative Plan" in your system instructions and cover its full scope faithfully.

Do NOT write any code. Produce only a plan.

{{previousPlanSection}}
{{humanAnswersSection}}
{{researchedAnswersSection}}
{{humanFeedbackSection}}
{{planReviewSection}}
