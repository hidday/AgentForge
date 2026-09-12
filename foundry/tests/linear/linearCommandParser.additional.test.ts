import { describe, it, expect } from "vitest";
import { parseLinearCommand } from "../../src/linear/linearCommandParser.js";

describe("parseLinearCommand - additional boundary cases", () => {
  it("returns null for an empty string (empty first line, no leading slash)", () => {
    expect(parseLinearCommand("")).toBeNull();
  });

  it("returns null for a string that is entirely whitespace", () => {
    expect(parseLinearCommand("   \n\n  ")).toBeNull();
  });

  it("does not match a command prefix that is only a substring of the first word", () => {
    // "/run-ai-extra" starts with "/run-ai" as a raw string but is not equal to it
    // and is not followed by a space, so it must not match "/run-ai".
    const result = parseLinearCommand("/run-ai-extra");
    expect(result).toEqual({ type: "unknown", raw: "/run-ai-extra" });
  });
});
