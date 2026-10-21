import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

// NOTE: as of this writing, nothing in src/ imports this module (grep for
// "mockGitHubData" turns up only this file and its definition) — it appears
// to be dead/demo-only fixture data, unlike its siblings mockCliOutputs.ts
// and mockLinearData.ts which server.ts actually wires up. Flagging for a
// human to confirm and remove rather than deleting it unasked.

describe("mockGitHubData", () => {
  it("MOCK_DIFF is a unified diff touching the expected files", () => {
    expect(MOCK_DIFF).toContain("diff --git a/src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("diff --git a/src/routes/users.ts");
    expect(MOCK_DIFF.startsWith("diff --git")).toBe(true);
  });

  it("MOCK_REPO_CONFIG has the shape of a valid repo config", () => {
    expect(MOCK_REPO_CONFIG.name).toBe("acme/backend-api");
    expect(MOCK_REPO_CONFIG.defaultBranch).toBe("main");
    expect(MOCK_REPO_CONFIG.allowedPaths).toContain("src/");
    expect(MOCK_REPO_CONFIG.protectedPaths).toContain(".github/");
  });
});
