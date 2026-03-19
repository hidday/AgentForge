## Plan Revision Task

A secondary reviewer has reviewed your plan. Evaluate their feedback and produce a revised plan.

### Original Issue

- **ID**: {{issue.id}}
- **Title**: {{issue.title}}
- **Description**: {{issue.description}}

### Your Original Plan (v{{plan.planVersion}})

**Summary**: {{plan.summary}}

**Steps**:
{{plan.steps}}

**Test Plan**: {{plan.testPlan}}

**Confidence**: {{plan.confidence}}

### Reviewer Feedback ({{planReview.reviewId}})

**Verdict**: {{planReview.overallVerdict}}
**Summary**: {{planReview.summary}}

**Findings**:
{{planReview.findings}}

### Definition of Done

{{definitionOfDone}}

## Instructions

1. Read each finding carefully
2. For each finding, decide: accept, dismiss, or partially incorporate
3. Provide a clear rationale for each decision
4. If accepting or partially incorporating, update the relevant plan steps
5. Produce the revised plan with an incremented version number
6. Adjust your confidence score based on the revisions
