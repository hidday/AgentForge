import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("mockGitHubData", () => {
  describe("MOCK_DIFF", () => {
    it("is a unified diff containing the expected file headers", () => {
      expect(MOCK_DIFF).toContain("diff --git a/src/middleware/validation.ts");
      expect(MOCK_DIFF).toContain("diff --git a/src/routes/users.ts");
      expect(MOCK_DIFF).toContain("+export function validateBody(schema: ZodSchema)");
    });
  });

  describe("MOCK_REPO_CONFIG", () => {
    it("has the expected repo identity fields", () => {
      expect(MOCK_REPO_CONFIG.name).toBe("acme/backend-api");
      expect(MOCK_REPO_CONFIG.defaultBranch).toBe("main");
      expect(MOCK_REPO_CONFIG.repoPath).toBe("./workspace");
    });

    it("includes prisma/migrations/ among the protected paths", () => {
      expect(MOCK_REPO_CONFIG.protectedPaths).toContain("prisma/migrations/");
      expect(MOCK_REPO_CONFIG.protectedPaths).toContain(".github/");
    });

    it("allows src/, tests/, and package.json as writable paths", () => {
      expect(MOCK_REPO_CONFIG.allowedPaths).toEqual(["src/", "tests/", "package.json"]);
    });
  });
});
