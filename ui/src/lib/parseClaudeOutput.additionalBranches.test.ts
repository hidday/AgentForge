import { describe, it, expect } from "vitest";
import { parseClaudeOutput, type ParsedBlock } from "./parseClaudeOutput";

describe("parseClaudeOutput additional branches – isNoiseLine short-circuit", () => {
  it("does not treat a line with stop_reason:null but no stop_sequence:null as noise", () => {
    const line = 'some text "stop_reason":null,"other":"value"}';
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([{ type: "raw", content: line }]);
  });

  it("filters a fragment matched only by the stop_reason+stop_sequence noise rule", () => {
    // Deliberately avoids any token/metadata keyword so it isn't caught by the
    // earlier METADATA_NOISE_RE or parent_tool_use_id+session_id checks —
    // only the dedicated stop_reason/stop_sequence rule should match it.
    const line = '"caller":{"type":"direct"}},"stop_reason":null,"stop_sequence":null}';
    expect(parseClaudeOutput(line)).toEqual([]);
  });
});

describe("parseClaudeOutput additional branches – content array item filtering", () => {
  it("skips null and non-object entries within a content array", () => {
    const line = JSON.stringify({
      content: [null, "a plain string", { type: "text", text: "kept" }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([{ type: "text", content: "kept" }]);
  });
});

describe("parseClaudeOutput additional branches – tool_result content shapes", () => {
  it("JSON-stringifies a tool_result whose content is an object", () => {
    const line = JSON.stringify([
      { type: "tool_result", content: { ok: true, value: 42 }, is_error: false },
    ]);
    const result = parseClaudeOutput(line);
    expect(result[0].type).toBe("tool_result");
    expect(result[0].content).toBe(JSON.stringify({ ok: true, value: 42 }));
  });

  it("stringifies a tool_result whose content is a number via String()", () => {
    const line = JSON.stringify([{ type: "tool_result", content: 7, is_error: false }]);
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("7");
  });

  it("falls back to an empty string for a tool_result with no content field at all", () => {
    const line = JSON.stringify([{ type: "tool_result", is_error: false }]);
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("");
  });
});

describe("parseClaudeOutput additional branches – formatToolInput edge cases", () => {
  it("returns an empty string when tool_use input is not an object", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Weird", input: "not-an-object" }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("");
  });

  it("returns an empty string when tool_use input is null", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Weird", input: null }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("");
  });

  it("uses the 'path' field when command/file_path/query are absent", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Glob", input: { path: "/src/components" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("/src/components");
  });

  it("returns short tool_use content input unmodified (no ellipsis)", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Write", input: { content: "short text" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("short text");
  });

  it("truncates a long JSON summary fallback with an ellipsis", () => {
    const bigInput: Record<string, string> = {};
    for (let i = 0; i < 30; i++) bigInput[`field${i}`] = "value".repeat(5);
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Custom", input: bigInput }],
    });
    const result = parseClaudeOutput(line);
    const fullSummary = JSON.stringify(bigInput);
    expect(fullSummary.length).toBeGreaterThan(200);
    expect(result[0].content).toHaveLength(201);
    expect(result[0].content.endsWith("…")).toBe(true);
  });
});
