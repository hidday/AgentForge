import { describe, it, expect } from "vitest";
import { parseClaudeOutput, type ParsedBlock } from "./parseClaudeOutput";

// ---------------------------------------------------------------------------
// Closes the remaining branch-coverage gap on the `stop_reason`/`stop_sequence`
// noise-line heuristic: both regexes must match for a line to be treated as
// noise. These cases exercise the short-circuit / false branches that the
// existing suite doesn't hit.
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – stop_reason/stop_sequence noise heuristic branches", () => {
  it("does NOT treat a line with stop_reason:null but no stop_sequence field as noise", () => {
    const line = 'plain fragment "stop_reason":null,"other":"x"';
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([{ type: "raw", content: line }]);
  });

  it("does NOT treat a line with stop_sequence:null but no stop_reason field as noise", () => {
    const line = 'plain fragment "stop_sequence":null,"other":"x"';
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([{ type: "raw", content: line }]);
  });

  it("does NOT treat a line with a non-null stop_reason and non-null stop_sequence as noise", () => {
    const line = '"stop_reason":"end_turn","stop_sequence":"foo"';
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([{ type: "raw", content: line }]);
  });
});
