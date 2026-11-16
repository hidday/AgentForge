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

describe("parseClaudeOutput – extractFromContentArray boundary conditions", () => {
  it("skips non-object entries in a content array instead of throwing", () => {
    const line = JSON.stringify({
      content: ["a plain string entry", null, { type: "text", text: "kept" }],
    });

    expect(parseClaudeOutput(line)).toEqual([{ type: "text", content: "kept" }]);
  });
});

describe("parseClaudeOutput – formatToolInput boundary conditions", () => {
  it("returns an empty string when a tool_use input is not an object", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Weird", input: "not-an-object" }],
    });

    const result = parseClaudeOutput(line);
    expect(result).toEqual([{ type: "tool_use", content: "", toolName: "Weird" }]);
  });

  it("returns an empty string when a tool_use input is null", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Weird", input: null }],
    });

    const result = parseClaudeOutput(line);
    expect(result).toEqual([{ type: "tool_use", content: "", toolName: "Weird" }]);
  });

  it("prefers a `path` field over the generic JSON summary", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Glob", input: { path: "/src/components" } }],
    });

    const result = parseClaudeOutput(line);
    expect(result).toEqual([
      { type: "tool_use", content: "/src/components", toolName: "Glob" },
    ]);
  });

  it("returns a short content field as-is, without truncation", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Write", input: { content: "short text" } }],
    });

    const result = parseClaudeOutput(line);
    expect(result).toEqual([
      { type: "tool_use", content: "short text", toolName: "Write" },
    ]);
  });

  it("truncates the JSON summary fallback when it exceeds 200 characters", () => {
    const bigInput: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      bigInput[`field_${i}`] = "value".repeat(5);
    }
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Custom", input: bigInput }],
    });

    const result = parseClaudeOutput(line);
    expect(result[0]!.content).toHaveLength(201); // 200 chars + "…"
    expect(result[0]!.content.endsWith("…")).toBe(true);
  });
});
