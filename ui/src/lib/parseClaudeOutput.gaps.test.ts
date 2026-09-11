import { describe, it, expect } from "vitest";
import { parseClaudeOutput } from "./parseClaudeOutput";

// ---------------------------------------------------------------------------
// Coverage gap: isNoiseLine's stop_reason/stop_sequence branch when it is
// reached WITHOUT the line already matching METADATA_NOISE_RE or the
// parent_tool_use_id+session_id pair. The existing test suite only exercises
// stop_reason/stop_sequence fragments that also contain an input_tokens (or
// similar) field, so METADATA_NOISE_RE short-circuits before the
// stop_reason/stop_sequence check ever executes its `return true`.
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – isNoiseLine stop_reason/stop_sequence-only branch", () => {
  it("filters a partial line whose only noise signal is stop_reason:null + stop_sequence:null", () => {
    // Not valid JSON on its own (missing opening brace), and it deliberately
    // has none of the METADATA_NOISE_RE fields (input_tokens, service_tier,
    // etc.) and no parent_tool_use_id/session_id pair, so this exercises the
    // third `isNoiseLine` branch in isolation.
    const fragment = 'text"}],"stop_reason":null,"stop_sequence":null}';
    expect(parseClaudeOutput(fragment)).toEqual([]);
  });

  it("does NOT filter a partial line with only stop_reason:null (no stop_sequence)", () => {
    // Sanity check on the boundary: stop_reason alone must not trip the
    // stop_reason+stop_sequence noise branch, and since it matches none of
    // the other noise checks either, it should survive as a raw block.
    const fragment = 'text"}],"stop_reason":null}';
    const result = parseClaudeOutput(fragment);
    expect(result).toEqual([{ type: "raw", content: fragment }]);
  });
});
