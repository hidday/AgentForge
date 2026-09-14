import { describe, it, expect } from "vitest";
import { ExecutionReportSchema, CheckResultSchema } from "../../src/schemas/executionReport.js";

function makeValidReport() {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "fail", details: "1 failing" },
    },
    notes: ["Note one"],
    prDraftCreated: true,
    score: 0.75,
    scoreRationale: "Solid implementation.",
  };
}

describe("CheckResultSchema", () => {
  it("passes through known statuses unchanged", () => {
    expect(CheckResultSchema.parse({ status: "pass", details: "ok" }).status).toBe("pass");
    expect(CheckResultSchema.parse({ status: "fail", details: "bad" }).status).toBe("fail");
    expect(CheckResultSchema.parse({ status: "skip", details: "n/a" }).status).toBe("skip");
  });

  it("coerces an unrecognized status string to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "warn", details: "unexpected" });
    expect(result.status).toBe("skip");
  });

  it("coerces an empty status string to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "", details: "" });
    expect(result.status).toBe("skip");
  });
});

describe("ExecutionReportSchema", () => {
  it("parses a well-formed execution report", () => {
    const parsed = ExecutionReportSchema.parse(makeValidReport());
    expect(parsed.score).toBe(0.75);
    expect(parsed.checks.tests.status).toBe("fail");
  });

  it("defaults executionVersion to 1 when omitted", () => {
    const { executionVersion: _drop, ...rest } = makeValidReport();
    const parsed = ExecutionReportSchema.parse(rest);
    expect(parsed.executionVersion).toBe(1);
  });

  it("rejects a score outside the [0, 1] range", () => {
    const invalid = { ...makeValidReport(), score: 1.5 };
    expect(ExecutionReportSchema.safeParse(invalid).success).toBe(false);
  });

  it("normalizes an unrecognized check status to 'skip' within the full report", () => {
    const withBadStatus = {
      ...makeValidReport(),
      checks: {
        ...makeValidReport().checks,
        lint: { status: "unknown-status", details: "model hallucinated a status" },
      },
    };
    const parsed = ExecutionReportSchema.parse(withBadStatus);
    expect(parsed.checks.lint.status).toBe("skip");
  });
});
