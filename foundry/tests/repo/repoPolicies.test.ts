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
  it("allows any path when allowedPaths is empty", () => {
    const result = validateFilePaths(["src/anything.ts"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("passes a file inside an allowed path", () => {
    const result = validateFilePaths(["src/foo.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file in a protected path even if it is also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.ts" is in a protected path']);
  });

  it("can report both an allowed-path and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["protected/file.ts"], ["src/"], ["protected/"]);
    expect(result.violations).toHaveLength(2);
  });

  it("validates multiple files independently", () => {
    const result = validateFilePaths(["src/ok.ts", "out/bad.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
  });
});

describe("validateDiffSize", () => {
  it("is valid when the file count is within the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid exactly at the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("flags when the file count exceeds the limit", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when no pattern matches", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\("]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports a matching forbidden pattern", () => {
    const result = checkForbiddenPatterns("eval('danger')", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("reports every matching pattern when multiple match", () => {
    const result = checkForbiddenPatterns(
      "eval('x'); process.env.SECRET",
      ["eval\\(", "process\\.env"],
    );
    expect(result.matches).toEqual(["eval\\(", "process\\.env"]);
  });

  it("returns no matches for an empty pattern list", () => {
    const result = checkForbiddenPatterns("anything goes", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
