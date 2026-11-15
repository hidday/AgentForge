import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("mockGitHubData", () => {
  it("exposes a unified diff with the expected file headers", () => {
    expect(MOCK_DIFF).toContain("diff --git a/src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("diff --git a/src/routes/users.ts");
  });

  it("exposes a mock repo config with allowed and protected paths", () => {
    expect(MOCK_REPO_CONFIG.name).toBe("acme/backend-api");
    expect(MOCK_REPO_CONFIG.defaultBranch).toBe("main");
    expect(MOCK_REPO_CONFIG.allowedPaths).toContain("src/");
    expect(MOCK_REPO_CONFIG.protectedPaths).toContain(".github/");
  });
});
