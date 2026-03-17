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

const MOCK_PLAN_REVIEWER_OUTPUT = wrap({
  success: true,
  stage: "plan-reviewer",
  payload: {
    reviewId: "plan-rev-001",
    summary:
      "The plan covers the core requirements well. However, it lacks an explicit step for handling error responses when the request body parser itself fails (malformed JSON). The test plan should also include integration-level tests.",
    findings: [
      {
        id: "pf1",
        severity: "important",
        type: "missing_requirement",
        affectedStepId: "s1",
        title: "No error handling for malformed JSON bodies",
        details:
          "The validation middleware step assumes req.body is always a parsed object. When Express receives malformed JSON, req.body may be undefined. The plan should include a step to handle body-parser failures explicitly, returning a clear 400 error before Zod validation runs.",
      },
      {
        id: "pf2",
        severity: "suggestion",
        type: "scope",
        title: "Consider adding OpenAPI schema generation",
        details:
          "Since Zod schemas are being created for all endpoints, it would be relatively low effort to also generate OpenAPI documentation from them. This is outside the stated requirements but could add significant value.",
      },
    ],
    overallVerdict: "changes_requested",
  },
});

const MOCK_PLAN_REVISER_OUTPUT = wrap({
  success: true,
  stage: "plan-reviser",
  payload: {
    revision: {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "plan-rev-001",
      dispositions: [
        {
          findingId: "pf1",
          status: "accepted",
          rationale:
            "Valid point. Express body-parser failures are a real edge case that the original plan missed. Adding a dedicated step for malformed body handling before Zod validation.",
        },
        {
          findingId: "pf2",
          status: "dismissed",
          rationale:
            "OpenAPI generation is out of scope for this issue. The requirements are specifically about request validation and error responses, not documentation. Adding this would expand scope beyond what was requested.",
        },
      ],
    },
    revisedPlan: {
      planVersion: 2,
      summary:
        "Add Zod-based request validation middleware to all API endpoints, returning structured 400 errors on invalid input. Includes explicit handling for malformed JSON bodies.",
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
      ],
      risks: [
        "Existing client code may send extra fields that would be rejected by strict validation",
        "Schema changes to request bodies could break integration tests",
      ],
      steps: [
        {
          id: "s1",
          title: "Create body-parser error handler",
          description:
            "Create middleware that catches body-parser failures (malformed JSON) and returns a 400 with a structured error before Zod validation runs",
        },
        {
          id: "s2",
          title: "Create validation middleware",
          description: "Create src/middleware/validation.ts with validateBody and validateQuery helpers",
        },
        {
          id: "s3",
          title: "Define request schemas",
          description: "Create Zod schemas for each POST/PUT endpoint's request body",
        },
        {
          id: "s4",
          title: "Apply middleware to routes",
          description: "Add body-parser error handler and validation middleware to all POST/PUT route handlers",
        },
        {
          id: "s5",
          title: "Add query parameter validation",
          description: "Create and apply Zod schemas for list endpoint query parameters",
        },
        {
          id: "s6",
          title: "Write tests",
          description: "Add tests for validation success, field-level errors, malformed JSON handling, and edge cases",
        },
      ],
      testPlan:
        "Test each endpoint with valid input, missing required fields, invalid types, boundary values, extra fields, and malformed JSON bodies. Verify error response format matches { errors: [{ field, message }] }. Include integration tests.",
      confidence: 0.92,
    },
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
      "The implementation is solid overall. Found one important issue with missing null body handling and a test coverage suggestion.",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/middleware/validation.ts",
        lineHint: 15,
        title: "Missing error handler for non-JSON request bodies",
        details:
          "If the request body is not valid JSON, schema.safeParse will receive undefined. The middleware should handle the case where req.body is undefined.",
      },
      {
        id: "f2",
        severity: "suggestion",
        type: "test-coverage",
        file: "tests/routes/products.test.ts",
        title: "Insufficient test coverage for product validation",
        details:
          "Add tests for invalid price, missing required fields, and boundary values.",
      },
      {
        id: "f3",
        severity: "nit",
        type: "style",
        file: "src/schemas/userSchemas.ts",
        lineHint: 8,
        title: "Consider extracting shared email schema",
        details: "The email validation pattern is repeated across schemas.",
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
      "All previous review findings have been addressed. Implementation looks good.",
    findings: [
      {
        id: "f4",
        severity: "nit",
        type: "style",
        file: "src/schemas/userSchemas.ts",
        lineHint: 8,
        title: "Consider extracting shared email schema",
        details: "Minor style suggestion carried forward -- not blocking.",
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
        action: "Added an explicit check for undefined/null req.body before calling safeParse. Returns 400 with a clear error when body is missing or unparseable.",
        rationale: "Genuine bug. Express with broken JSON or missing content-type header produces undefined body, which would bypass validation silently. Good catch.",
      },
      {
        findingId: "f2",
        status: "rejected",
        action: "No changes made.",
        rationale: "The existing tests cover the validation contract for the products endpoint (valid input, missing fields, type errors). Adding negative price tests and string length boundary tests is out of scope for this PR -- the issue is about adding validation middleware, not exhaustive domain-level testing. The current coverage is sufficient for the stated requirements.",
      },
      {
        findingId: "f3",
        status: "rejected",
        action: "No changes made.",
        rationale: "Email validation appears in exactly one schema. Extracting a shared helper for a single use site adds indirection without benefit. If email validation is needed in additional schemas later, this refactor can be done then.",
      },
    ],
    rerunChecks: {
      lint: { status: "pass", details: "No lint errors found" },
      typecheck: { status: "pass", details: "No type errors" },
      tests: { status: "pass", details: "48 tests passed, 0 failed" },
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
    const stdinContent = (options.stdinData ?? "").toLowerCase();

    if (isClaude) {
      if (stdinContent.includes("plan revision") || stdinContent.includes("plan-reviser") || stdinContent.includes("lead engineer")) {
        stdout = MOCK_PLAN_REVISER_OUTPUT;
      } else if (stdinContent.includes("planner") || stdinContent.includes("implementation plan")) {
        stdout = MOCK_PLANNER_OUTPUT;
      } else if (stdinContent.includes("remediat")) {
        stdout = MOCK_REMEDIATION_OUTPUT;
      } else {
        stdout = MOCK_EXECUTOR_OUTPUT;
      }
    } else if (isCodex) {
      const codexCalls = (callCounts.get("codex") ?? 0) + 1;
      callCounts.set("codex", codexCalls);

      if (stdinContent.includes("plan review") || stdinContent.includes("plan-reviewer") || stdinContent.includes("plan under review")) {
        stdout = MOCK_PLAN_REVIEWER_OUTPUT;
      } else {
        // Code review: first call returns changes_requested, second returns approved
        const codeReviewCalls = (callCounts.get("code-review") ?? 0) + 1;
        callCounts.set("code-review", codeReviewCalls);
        stdout = codeReviewCalls <= 1
          ? MOCK_REVIEWER_CHANGES_REQUESTED_OUTPUT
          : MOCK_REVIEWER_APPROVED_OUTPUT;
      }
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
