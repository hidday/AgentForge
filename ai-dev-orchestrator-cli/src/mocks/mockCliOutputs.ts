import type { ProcessResult, ProcessSpawnOptions } from "../runtime/runnerTypes.js";
import {
  STRUCTURED_OUTPUT_BEGIN,
  STRUCTURED_OUTPUT_END,
} from "../schemas/cliProtocol.js";

function wrap(json: object): string {
  return [
    "Analyzing the task...",
    "",
    "I've reviewed the requirements and repository structure.",
    "",
    STRUCTURED_OUTPUT_BEGIN,
    JSON.stringify(json, null, 2),
    STRUCTURED_OUTPUT_END,
  ].join("\n");
}

const MOCK_PLANNER_OUTPUT = wrap({
  success: true,
  stage: "planner",
  payload: {
    planVersion: 1,
    summary:
      "Add Zod-based request validation middleware to all API endpoints, returning structured 400 errors on invalid input.",
    assumptions: [
      "The project uses Express with TypeScript",
      "Zod is already a project dependency or can be added",
      "Existing tests use Jest or Vitest",
      "No existing validation middleware is in place",
    ],
    openQuestions: [
      {
        id: "q1",
        question: "Should validation strip unknown fields or reject them?",
        requiredForExecution: false,
      },
      {
        id: "q2",
        question: "Are there rate-limiting or auth middleware that should run before validation?",
        requiredForExecution: false,
      },
    ],
    risks: [
      "Existing client code may send extra fields that would be rejected by strict validation",
      "Schema changes to request bodies could break integration tests",
    ],
    steps: [
      {
        id: "s1",
        title: "Create validation middleware",
        description: "Create src/middleware/validation.ts with validateBody and validateQuery helpers",
      },
      {
        id: "s2",
        title: "Define request schemas",
        description: "Create Zod schemas for each POST/PUT endpoint's request body",
      },
      {
        id: "s3",
        title: "Apply middleware to routes",
        description: "Add validation middleware to all POST/PUT route handlers",
      },
      {
        id: "s4",
        title: "Add query parameter validation",
        description: "Create and apply Zod schemas for list endpoint query parameters",
      },
      {
        id: "s5",
        title: "Write tests",
        description: "Add tests for validation success, field-level errors, and edge cases",
      },
    ],
    testPlan:
      "Test each endpoint with valid input, missing required fields, invalid types, boundary values, and extra fields. Verify error response format matches { errors: [{ field, message }] }.",
    confidence: 0.9,
  },
});

const MOCK_EXECUTOR_OUTPUT = wrap({
  success: true,
  stage: "executor",
  payload: {
    summary:
      "Implemented Zod validation middleware and applied it to all POST/PUT endpoints. Added query param validation for list endpoints. All checks pass.",
    filesChanged: [
      "src/middleware/validation.ts",
      "src/routes/users.ts",
      "src/routes/products.ts",
      "src/schemas/userSchemas.ts",
      "src/schemas/productSchemas.ts",
      "tests/middleware/validation.test.ts",
      "tests/routes/users.test.ts",
    ],
    checks: {
      lint: { status: "pass", details: "No lint errors found" },
      typecheck: { status: "pass", details: "No type errors" },
      tests: { status: "pass", details: "47 tests passed, 0 failed" },
    },
    notes: [
      "Added zod as a dependency (was not previously installed)",
      "Used strip() mode for unknown fields to avoid breaking existing clients",
    ],
    prDraftCreated: true,
  },
});

const MOCK_REVIEWER_CHANGES_REQUESTED_OUTPUT = wrap({
  success: true,
  stage: "reviewer",
  payload: {
    reviewId: "rev-001",
    summary:
      "The implementation is solid overall. Validation middleware is well-structured and applied consistently. Found two issues: a missing null check on nested object validation and insufficient test coverage for the products endpoint.",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/middleware/validation.ts",
        lineHint: 15,
        title: "Missing error handler for non-JSON request bodies",
        details:
          "If the request body is not valid JSON, schema.safeParse will receive undefined instead of throwing a parse error. The middleware should handle the case where req.body is undefined and return a clear error.",
      },
      {
        id: "f2",
        severity: "suggestion",
        type: "test-coverage",
        file: "tests/routes/products.test.ts",
        title: "Insufficient test coverage for product validation",
        details:
          "The product endpoint tests only cover the happy path. Add tests for invalid price (negative numbers, non-numeric), missing required fields, and boundary values for string lengths.",
      },
      {
        id: "f3",
        severity: "nit",
        type: "style",
        file: "src/schemas/userSchemas.ts",
        lineHint: 8,
        title: "Consider extracting shared email schema",
        details:
          "The email validation pattern is repeated. Consider creating a shared emailSchema that can be reused across user and other schemas.",
      },
    ],
    overallVerdict: "changes_requested",
  },
});

const MOCK_REVIEWER_APPROVED_OUTPUT = wrap({
  success: true,
  stage: "reviewer",
  payload: {
    reviewId: "rev-002",
    summary:
      "All previous review findings have been addressed. The null body check is in place, product tests cover edge cases. Implementation looks good.",
    findings: [
      {
        id: "f4",
        severity: "nit",
        type: "style",
        file: "src/schemas/userSchemas.ts",
        lineHint: 8,
        title: "Consider extracting shared email schema",
        details:
          "Minor style suggestion carried forward — not blocking.",
      },
    ],
    overallVerdict: "approved",
  },
});

const MOCK_REMEDIATION_OUTPUT = wrap({
  success: true,
  stage: "remediation",
  payload: {
    reviewId: "rev-001",
    resolution: [
      {
        findingId: "f1",
        status: "accepted",
        action:
          "Added an explicit check for undefined/null req.body before calling safeParse. Returns 400 with a clear error message when body is missing or unparseable.",
        rationale:
          "The reviewer correctly identified a gap. Express with broken JSON or missing content-type header can produce undefined body.",
      },
      {
        findingId: "f2",
        status: "accepted",
        action:
          "Added 8 new test cases for products endpoint covering negative prices, non-numeric values, missing required fields, and string length boundaries.",
        rationale: "Test coverage was genuinely insufficient for the products endpoint.",
      },
      {
        findingId: "f3",
        status: "rejected",
        action: "No changes made.",
        rationale:
          "While extracting a shared email schema is a good idea in general, in this codebase the email field only appears in the user schema. Will revisit if email validation is needed elsewhere.",
      },
    ],
    rerunChecks: {
      lint: { status: "pass", details: "No lint errors found" },
      typecheck: { status: "pass", details: "No type errors" },
      tests: { status: "pass", details: "55 tests passed, 0 failed" },
    },
    readyForHumanReview: true,
  },
});

export function createMockProcessHandler(): (
  options: ProcessSpawnOptions,
) => Promise<ProcessResult> {
  const callCounts = new Map<string, number>();

  return async (options: ProcessSpawnOptions): Promise<ProcessResult> => {
    let stdout: string;

    const isCodex = options.command.endsWith("codex") || options.command === "codex";
    const isClaude = options.command.endsWith("claude") || options.command === "claude";

    if (isClaude) {
      const stdinContent = (options.stdinData ?? "").toLowerCase();
      if (stdinContent.includes("planner") || stdinContent.includes("plan")) {
        stdout = MOCK_PLANNER_OUTPUT;
      } else if (stdinContent.includes("remediat")) {
        stdout = MOCK_REMEDIATION_OUTPUT;
      } else {
        stdout = MOCK_EXECUTOR_OUTPUT;
      }
    } else if (isCodex) {
      const codexCalls = (callCounts.get("codex") ?? 0) + 1;
      callCounts.set("codex", codexCalls);

      // First codex call returns changes_requested, subsequent calls return approved
      stdout = codexCalls <= 1
        ? MOCK_REVIEWER_CHANGES_REQUESTED_OUTPUT
        : MOCK_REVIEWER_APPROVED_OUTPUT;
    } else {
      stdout = wrap({ success: false, stage: "planner", payload: {} });
    }

    return {
      stdout,
      stderr: "",
      exitCode: 0,
      durationMs: 1500 + Math.floor(Math.random() * 500),
      timedOut: false,
    };
  };
}
