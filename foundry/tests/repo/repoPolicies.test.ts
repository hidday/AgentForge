import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

function makeConstraints(overrides: Partial<Constraints> = {}): Constraints {
  return {
    requiredChecks: [],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

describe("validateFilePaths", () => {
  it("is valid when every file is within an allowed path and none are protected", () => {
    const result = validateFilePaths(["src/foo.ts", "src/bar.ts"], ["src/"], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags files outside every allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("flags files inside a protected path even if also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.ts" is in a protected path']);
  });

  it("reports both violations when a file is both disallowed and protected", () => {
    const result = validateFilePaths(["locked/file.ts"], ["src/"], ["locked/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "locked/file.ts" is not in any allowed path',
      'File "locked/file.ts" is in a protected path',
    ]);
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("accumulates violations across multiple files", () => {
    const result = validateFilePaths(["ok/a.ts", "bad/b.ts"], ["ok/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("bad/b.ts");
  });
});

describe("validateDiffSize", () => {
  it("is valid when filesChanged is within maxFilesChanged", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("is valid at exactly the boundary (equal to maxFilesChanged)", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("flags when filesChanged exceeds maxFilesChanged", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches no forbidden patterns", () => {
    const result = checkForbiddenPatterns("const safe = 1;", ["eval\\(", "process\\.exit"]);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("reports each forbidden pattern that matches", () => {
    const result = checkForbiddenPatterns("eval(x); process.exit(1);", [
      "eval\\(",
      "process\\.exit",
    ]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });

  it("returns valid true when the forbiddenPatterns list is empty", () => {
    const result = checkForbiddenPatterns("anything at all", []);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("matches only the patterns that occur in the content, not all supplied patterns", () => {
    const result = checkForbiddenPatterns("uses eval(danger)", ["eval\\(", "TODO"]);
    expect(result.matches).toEqual(["eval\\("]);
  });
});
