import type { LinearIssue } from "../linear/linearClient.js";

export const MOCK_ISSUE: LinearIssue = {
  id: "LIN-1042",
  identifier: "LIN-1042",
  title: "Add request validation middleware to API endpoints",
  branchName: "mock/lin-1042-add-request-validation-middleware",
  description: [
    "## Problem",
    "Our API endpoints lack consistent input validation. Several endpoints accept",
    "malformed payloads silently, which has caused data corruption in production.",
    "",
    "## Requirements",
    "- Add Zod-based request validation to all POST/PUT endpoints",
    "- Return structured 400 errors with field-level details on invalid input",
    "- Add validation for query parameters on GET endpoints",
    "- Ensure no existing tests break",
    "",
    "## Acceptance Criteria",
    "- All POST/PUT endpoints validate request bodies",
    "- Validation errors return 400 with { errors: [{ field, message }] }",
    "- Query params on list endpoints are validated",
    "- All existing tests continue to pass",
    "- New tests cover validation edge cases",
  ].join("\n"),
  state: "Todo",
  labels: ["bug", "api", "validation"],
  priority: 2,
  url: "https://linear.app/mock-team/issue/LIN-1042",
  project: "Backend Platform",
  cycle: "Sprint 23",
};

export const MOCK_LINEAR_STATES = {
  todo: "Todo",
  inProgress: "In Progress",
  inReview: "In Review",
  done: "Done",
  cancelled: "Cancelled",
} as const;
