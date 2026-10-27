import { describe, it, expect } from "vitest";
import { parseLinearCommand } from "../../src/linear/linearCommandParser.js";

describe("parseLinearCommand edge cases", () => {
  it("returns null for an empty string (no first line content, no slash)", () => {
    expect(parseLinearCommand("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(parseLinearCommand("   \n   ")).toBeNull();
  });

  it("returns null for a string that is only a newline", () => {
    expect(parseLinearCommand("\n")).toBeNull();
  });

  it("treats a bare slash with no command name as unknown", () => {
    expect(parseLinearCommand("/")).toEqual({ type: "unknown", raw: "/" });
  });

  it("does not match a command prefix that is only a partial/longer word (e.g. /ai-plans)", () => {
    expect(parseLinearCommand("/ai-plans")).toEqual({ type: "unknown", raw: "/ai-plans" });
  });

  it("matches a known command even when followed by trailing whitespace only", () => {
    expect(parseLinearCommand("/run-ai   ")).toEqual({ type: "run-ai" });
  });

  it("uses only the first line when later lines contain a different command", () => {
    const result = parseLinearCommand("/approve-plan\n/reject-plan ignored");
    expect(result).toEqual({ type: "approve-plan" });
  });
});
