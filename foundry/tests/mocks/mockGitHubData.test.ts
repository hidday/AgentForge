import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

/** Minimal unified-diff structural parse: splits into per-file sections. */
function splitDiffSections(diff: string): string[] {
  return diff.split(/(?=^diff --git )/m).filter((s) => s.length > 0);
}

describe("MOCK_DIFF", () => {
  it("is a non-empty string", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
  });

  it("starts with a 'diff --git' header naming the same path for a/ and b/", () => {
    expect(MOCK_DIFF.startsWith("diff --git a/")).toBe(true);
    const firstLine = MOCK_DIFF.split("\n")[0]!;
    const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(firstLine);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(match![2]);
    expect(match![1]).toBe("src/middleware/validation.ts");
  });

  it("contains two file sections: a new file and a modified file", () => {
    const sections = splitDiffSections(MOCK_DIFF);
    expect(sections).toHaveLength(2);

    expect(sections[0]).toContain("diff --git a/src/middleware/validation.ts b/src/middleware/validation.ts");
    expect(sections[0]).toContain("new file mode 100644");
    expect(sections[0]).toContain("--- /dev/null");
    expect(sections[0]).toContain("+++ b/src/middleware/validation.ts");

    expect(sections[1]).toContain("diff --git a/src/routes/users.ts b/src/routes/users.ts");
    expect(sections[1]).toContain("--- a/src/routes/users.ts");
    expect(sections[1]).toContain("+++ b/src/routes/users.ts");
  });

  it("each file section has at least one valid hunk header (@@ -l,s +l,s @@)", () => {
    const sections = splitDiffSections(MOCK_DIFF);
    const hunkHeaderRe = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m;
    for (const section of sections) {
      expect(hunkHeaderRe.test(section)).toBe(true);
    }
  });

  it("every content line starts with a valid unified-diff marker ('+', '-', ' ') or is a diff/meta line", () => {
    const lines = MOCK_DIFF.split("\n").filter((l) => l.length > 0);
    const metaRe = /^(diff --git|index |new file mode|---|\+\+\+|@@ )/;
    for (const line of lines) {
      const isContent = line.startsWith("+") || line.startsWith("-") || line.startsWith(" ");
      const isMeta = metaRe.test(line);
      expect(isContent || isMeta).toBe(true);
    }
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has the expected shape for a repo configuration fixture", () => {
    expect(MOCK_REPO_CONFIG).toMatchObject({
      name: "acme/backend-api",
      defaultBranch: "main",
      repoPath: "./workspace",
    });
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
  });
});
