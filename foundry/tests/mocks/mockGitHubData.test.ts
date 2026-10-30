import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a well-formed unified diff touching the expected files", () => {
    expect(MOCK_DIFF).toContain("diff --git a/src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("diff --git a/src/routes/users.ts");
    expect(MOCK_DIFF).toContain("+export function validateBody(schema: ZodSchema)");
    expect(MOCK_DIFF.startsWith("diff --git")).toBe(true);
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("is a well-formed repo config fixture", () => {
    expect(MOCK_REPO_CONFIG).toEqual({
      name: "acme/backend-api",
      defaultBranch: "main",
      repoPath: "./workspace",
      allowedPaths: ["src/", "tests/", "package.json"],
      protectedPaths: [".github/", "infrastructure/", "prisma/migrations/"],
    });
  });
});
