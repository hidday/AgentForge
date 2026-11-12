import { describe, it, expect } from "vitest";
import { parseClaudeOutput } from "./parseClaudeOutput.ts";

// Closes a coverage gap in parseClaudeOutput.ts's isNoiseLine: a non-JSON
// line fragment carrying both `"stop_reason": null` and
// `"stop_sequence": null` should be treated as API metadata noise and
// dropped, not emitted as a raw block.
describe("parseClaudeOutput – stop_reason/stop_sequence noise fragment", () => {
  it("drops a malformed-JSON fragment containing both stop_reason:null and stop_sequence:null", () => {
    const fragment = '"stop_reason": null, "stop_sequence": null';
    expect(parseClaudeOutput(fragment)).toEqual([]);
  });

  it("still emits a raw block when only stop_reason:null is present (not both fields)", () => {
    const fragment = '"stop_reason": null, something else';
    const result = parseClaudeOutput(fragment);
    expect(result).toEqual([{ type: "raw", content: fragment }]);
  });

  it("drops the noise fragment but keeps a following meaningful raw line", () => {
    const raw = [
      '"stop_reason": null, "stop_sequence": null',
      "actual agent output line",
    ].join("\n");

    const result = parseClaudeOutput(raw);
    expect(result).toEqual([{ type: "raw", content: "actual agent output line" }]);
  });
});
