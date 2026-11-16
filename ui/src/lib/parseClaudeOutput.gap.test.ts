import { describe, it, expect } from "vitest";
import { parseClaudeOutput } from "./parseClaudeOutput.ts";

// Targets the stop_reason:null + stop_sequence:null noise-detection branch
// in isNoiseLine() for a fragment that does NOT also match
// METADATA_NOISE_RE or the parent_tool_use_id+session_id pattern, so this
// specific check is what filters it out.
describe("parseClaudeOutput – stop_reason/stop_sequence noise without other metadata markers", () => {
  it("filters a partial line containing only stop_reason:null and stop_sequence:null", () => {
    const fragment = '],"stop_reason":null,"stop_sequence":null}';

    expect(parseClaudeOutput(fragment)).toEqual([]);
  });

  it("keeps a line with only stop_reason:null (no stop_sequence) as raw content", () => {
    const fragment = '],"stop_reason":null}';

    expect(parseClaudeOutput(fragment)).toEqual([
      { type: "raw", content: fragment },
    ]);
  });
});
