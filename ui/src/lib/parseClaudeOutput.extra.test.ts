import { describe, it, expect } from "vitest";
import { parseClaudeOutput } from "./parseClaudeOutput.ts";

// Additional coverage for the `isNoiseLine` fragment-matching branch that
// filters out split stop_reason/stop_sequence NDJSON fragments. This is a
// supplementary file so the existing parseClaudeOutput.test.ts is left
// untouched.
describe("parseClaudeOutput – stop_reason/stop_sequence noise fragment", () => {
  it("drops a non-JSON fragment containing both stop_reason:null and stop_sequence:null", () => {
    const fragment = '"stop_reason":null,"stop_sequence":null}';
    expect(parseClaudeOutput(fragment)).toEqual([]);
  });

  it("does NOT drop a fragment with only stop_reason:null (missing stop_sequence)", () => {
    const fragment = 'garbage "stop_reason":null only';
    const result = parseClaudeOutput(fragment);
    expect(result).toEqual([{ type: "raw", content: fragment }]);
  });

  it("does NOT drop a fragment where stop_sequence is non-null", () => {
    const fragment = '"stop_reason":null,"stop_sequence":"foo"';
    const result = parseClaudeOutput(fragment);
    expect(result).toEqual([{ type: "raw", content: fragment }]);
  });
});
