import { describe, it, expect } from "vitest";
import { parseLinearCommand } from "../../src/linear/linearCommandParser.js";

describe("parseLinearCommand — first-line extraction edge cases", () => {
  // `trimmed.split("\n")[0]?.trim() ?? ""` has a defensive `?.`/`??` fallback
  // for an undefined first element. String.prototype.split always returns at
  // least a one-element array (even for ""), so `[0]` can never actually be
  // undefined here -- this is documented, not forced, since reaching it would
  // require mocking a built-in (String.prototype.split), which would be
  // brittle rather than a meaningful test of this module's behavior.
  it("handles an entirely empty string as non-command input", () => {
    expect(parseLinearCommand("")).toBeNull();
  });

  it("handles a string that is only whitespace as non-command input", () => {
    expect(parseLinearCommand("   \n\n   ")).toBeNull();
  });

  it("handles a single newline with no content before or after", () => {
    expect(parseLinearCommand("\n")).toBeNull();
  });
});
