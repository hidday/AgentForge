import { describe, it, expect } from "vitest";
import { parseClaudeOutput } from "./parseClaudeOutput.ts";

// Additive coverage for parseClaudeOutput.ts. See parseClaudeOutput.test.ts
// for the main suite; this file closes a remaining branch gap without
// touching the existing assertions there.
describe("parseClaudeOutput – isNoiseLine stop_reason/stop_sequence branch in isolation", () => {
  it("filters a partial line with stop_reason:null + stop_sequence:null but no other metadata markers", () => {
    // Deliberately avoids input_tokens / parent_tool_use_id+session_id so the
    // earlier checks in isNoiseLine don't short-circuit before this fragment
    // reaches the stop_reason/stop_sequence check specifically.
    const fragment =
      'parser"},"caller":{"type":"direct"}}],"stop_reason":null,"stop_sequence":null}';
    expect(parseClaudeOutput(fragment)).toEqual([]);
  });

  it("does NOT filter a line with only stop_reason:null (no stop_sequence) as noise", () => {
    const fragment = 'parser"},"caller":{"type":"direct"}}],"stop_reason":null}';
    // Not valid JSON and doesn't match any noise pattern, so it should pass
    // through as a raw block.
    expect(parseClaudeOutput(fragment)).toEqual([
      { type: "raw", content: fragment },
    ]);
  });
});
