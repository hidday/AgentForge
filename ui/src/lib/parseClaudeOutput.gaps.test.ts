import { describe, it, expect } from "vitest";
import { parseClaudeOutput } from "./parseClaudeOutput.ts";

describe("parseClaudeOutput - noise line with null stop_reason/stop_sequence", () => {
  it("drops a non-JSON fragment containing both stop_reason:null and stop_sequence:null as noise", () => {
    // Deliberately malformed/truncated so tryParseJSON fails and the line
    // falls through to isNoiseLine, which should recognize this pattern as
    // wrapper noise rather than emitting a 'raw' block for it.
    const raw = '{"stop_reason":null,"stop_sequence":null,"trunc';
    expect(parseClaudeOutput(raw)).toEqual([]);
  });
});
