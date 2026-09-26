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
    maxFilesChanged: 5,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

describe("validateFilePaths", () => {
  it("is valid when every file is within an allowed path and none is protected", () => {
    const result = validateFilePaths(["src/foo.ts", "src/bar.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as 'anything is allowed'", () => {
    const result = validateFilePaths(["anywhere/foo.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("flags a file outside all allowed paths", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("flags a file inside a protected path even if it's also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('File "src/secrets.ts" is in a protected path');
  });

  it("reports both violations for a file that is neither allowed nor protected-safe", () => {
    const result = validateFilePaths(["etc/config.ts"], ["src/"], ["etc/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toContain('File "etc/config.ts" is not in any allowed path');
    expect(result.violations).toContain('File "etc/config.ts" is in a protected path');
  });

  it("returns valid=true with no violations for an empty file list", () => {
    const result = validateFilePaths([], ["src/"], ["etc/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  it("is valid when the number of changed files is within maxFilesChanged", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid at the exact boundary (filesChanged.length === maxFilesChanged)", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("is invalid when the number of changed files exceeds maxFilesChanged", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches none of the forbidden patterns", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "TODO"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports each forbidden pattern that matches the content", () => {
    const result = checkForbiddenPatterns("eval(userInput); // TODO: fix", ["eval\\(", "TODO"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "TODO"]);
  });

  it("is valid (no matches) when there are no forbidden patterns to check", () => {
    const result = checkForbiddenPatterns("anything goes here", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("supports regex patterns beyond plain substrings", () => {
    const result = checkForbiddenPatterns("password = \"hunter2\"", ["password\\s*="]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["password\\s*="]);
  });
});
