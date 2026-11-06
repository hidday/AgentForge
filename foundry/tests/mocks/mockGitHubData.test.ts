import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("mockGitHubData fixtures", () => {
  it("MOCK_DIFF is a non-empty unified diff", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF).toContain("--- a/");
    expect(MOCK_DIFF).toContain("+++ b/");
  });

  it("MOCK_REPO_CONFIG declares allowed and protected paths", () => {
    expect(MOCK_REPO_CONFIG.name).toBe("acme/backend-api");
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
  });
});
