import { describe, it, expect } from "vitest";
import { parseLinearCommand } from "../../src/linear/linearCommandParser.js";

describe("parseLinearCommand - additional commands and edge cases", () => {
  it("parses '/run-ai'", () => {
    expect(parseLinearCommand("/run-ai")).toEqual({ type: "run-ai" });
  });

  it("parses '/re-review'", () => {
    expect(parseLinearCommand("/re-review")).toEqual({ type: "re-review" });
  });

  it("parses '/resume-ai'", () => {
    expect(parseLinearCommand("/resume-ai")).toEqual({ type: "resume-ai" });
  });

  it("returns null for an empty string", () => {
    expect(parseLinearCommand("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(parseLinearCommand("   \n   ")).toBeNull();
  });
});
