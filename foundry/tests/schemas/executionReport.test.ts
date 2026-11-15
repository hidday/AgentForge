import { describe, it, expect } from "vitest";
import { CheckResultSchema } from "../../src/schemas/executionReport.js";

describe("CheckResultSchema status normalization", () => {
  it.each(["pass", "fail", "skip"])("keeps a known status (%s) as-is", (status) => {
    const result = CheckResultSchema.parse({ status, details: "ok" });
    expect(result.status).toBe(status);
  });

  it("falls back to 'skip' for an unrecognized status value", () => {
    const result = CheckResultSchema.parse({ status: "pending", details: "not run yet" });
    expect(result.status).toBe("skip");
  });
});
