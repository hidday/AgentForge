import { describe, it, expect } from "vitest";
import { parseClaudeOutput, type ParsedBlock } from "./parseClaudeOutput";

// ---------------------------------------------------------------------------
// Closes the remaining branch-coverage gap on the `stop_reason`/`stop_sequence`
// noise-line heuristic: both regexes must match for a line to be treated as
// noise. These cases exercise the short-circuit / false branches that the
// existing suite doesn't hit.
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – stop_reason/stop_sequence noise heuristic branches", () => {
  it("treats a malformed line with both stop_reason:null and stop_sequence:null as noise, even without other metadata fields", () => {
    // Deliberately avoids any METADATA_NOISE_RE keyword (usage/tokens/service_tier/etc.)
    // so this exercises the dedicated stop_reason+stop_sequence heuristic itself.
    const line = 'foo"stop_reason":null,"stop_sequence":null,"bar":1}';
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([]);
  });

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

// ---------------------------------------------------------------------------
// Remaining branch gaps: a JSON line that parses to a non-object, non-array
// value (the top-level `typeof parsed === "object"` else path).
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – top-level JSON that isn't an array or object", () => {
  it("produces no blocks for a bare JSON string line", () => {
    expect(parseClaudeOutput('"just a string"')).toEqual<ParsedBlock[]>([]);
  });

  it("produces no blocks for a bare JSON number line", () => {
    expect(parseClaudeOutput("42")).toEqual<ParsedBlock[]>([]);
  });
});

// ---------------------------------------------------------------------------
// tool_use_result whose value is neither a string nor an object (falls
// through both branches with nothing pushed).
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – tool_use_result of an unexpected type", () => {
  it("ignores a numeric tool_use_result", () => {
    const line = JSON.stringify({ tool_use_result: 42 });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([]);
  });

  it("ignores a null tool_use_result", () => {
    const line = JSON.stringify({ tool_use_result: null });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([]);
  });
});

// ---------------------------------------------------------------------------
// content_block_start whose content_block isn't a tool_use block.
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – content_block_start with a non-tool_use block", () => {
  it("emits nothing for a content_block_start with a text content_block", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "text", text: "" },
    });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([]);
  });
});

// ---------------------------------------------------------------------------
// extractFromContentArray: non-object items, and entry types other than
// text/tool_use/tool_result.
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – content array edge entries", () => {
  it("skips non-object entries (string, number, null) within a content array", () => {
    const line = JSON.stringify({ content: ["a string", 42, null, { type: "text", text: "hi" }] });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([{ type: "text", content: "hi" }]);
  });

  it("ignores a content array entry whose type isn't text/tool_use/tool_result", () => {
    const line = JSON.stringify({ content: [{ type: "thinking", thinking: "hmm" }] });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([]);
  });

  it("JSON-stringifies a tool_result whose content is an object", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: { foo: "bar" }, is_error: false }],
    });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([
      { type: "tool_result", content: JSON.stringify({ foo: "bar" }), isError: false },
    ]);
  });

  it("stringifies a tool_result whose content is a number via String()", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: 7, is_error: false }],
    });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([
      { type: "tool_result", content: "7", isError: false },
    ]);
  });

  it("falls back to an empty string for a tool_result with no content field", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", is_error: true }],
    });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([
      { type: "tool_result", content: "", isError: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// formatToolInput: non-object input, the `path` field specifically, and the
// short (non-truncated) branches of both truncation ternaries.
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – formatToolInput branches", () => {
  it("returns an empty string when a tool_use's input is not an object", () => {
    const line = JSON.stringify({ content: [{ type: "tool_use", name: "Bash", input: null }] });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([
      { type: "tool_use", content: "", toolName: "Bash" },
    ]);
  });

  it("uses the `path` field when command/file_path/query are absent", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Read", input: { path: "/tmp/foo.txt" } }],
    });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([
      { type: "tool_use", content: "/tmp/foo.txt", toolName: "Read" },
    ]);
  });

  it("returns short `content` input untruncated", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Write", input: { content: "short text" } }],
    });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([
      { type: "tool_use", content: "short text", toolName: "Write" },
    ]);
  });

  it("truncates a `content` input longer than 200 characters with an ellipsis", () => {
    const long = "x".repeat(250);
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Write", input: { content: long } }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe(long.slice(0, 200) + "…");
  });

  it("returns a short JSON summary of an object input with no known fields, untruncated", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Custom", input: { a: 1 } }],
    });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([
      { type: "tool_use", content: JSON.stringify({ a: 1 }), toolName: "Custom" },
    ]);
  });

  it("truncates a long JSON summary of an object input with no known fields", () => {
    const bigObj: Record<string, string> = {};
    for (let i = 0; i < 30; i++) bigObj[`key${i}`] = "value-value-value";
    const summary = JSON.stringify(bigObj);
    expect(summary.length).toBeGreaterThan(200);

    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Custom", input: bigObj }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe(summary.slice(0, 200) + "…");
  });
});
