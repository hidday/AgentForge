import { describe, it, expect } from "vitest";
import { parseClaudeOutput, type ParsedBlock } from "./parseClaudeOutput.ts";

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

describe("parseClaudeOutput – top-level JSON that parses but isn't an array or object", () => {
  it("produces no block for a line that parses to a bare number", () => {
    expect(parseClaudeOutput("42")).toEqual([]);
  });

  it("treats a line that parses to JSON null as falsy, falling through to the raw-line path", () => {
    // `null` is falsy, so it takes the same early `!parsed` branch as a
    // parse failure, never reaching the array/object type checks.
    expect(parseClaudeOutput("null")).toEqual<ParsedBlock[]>([{ type: "raw", content: "null" }]);
  });

  it("produces no block for a line that parses to a boolean", () => {
    expect(parseClaudeOutput("true")).toEqual([]);
  });
});

describe("parseClaudeOutput – tool_use_result wrapper edge cases", () => {
  it("produces no block when tool_use_result is neither a string nor an object (e.g. a number)", () => {
    const line = JSON.stringify({ tool_use_result: 42 });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("produces no block when tool_use_result is an object with only whitespace stdout/stderr", () => {
    const line = JSON.stringify({ tool_use_result: { stdout: "   ", stderr: "\n" } });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("builds a tool_result block from stdout alone when stderr is absent", () => {
    const line = JSON.stringify({ tool_use_result: { stdout: "all good" } });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([
      { type: "tool_result", content: "all good", isError: false },
    ]);
  });

  it("builds a tool_result block from stderr alone when stdout is absent, joining stdout+stderr with a newline when both present", () => {
    const onlyStderr = JSON.stringify({ tool_use_result: { stderr: "oops" } });
    expect(parseClaudeOutput(onlyStderr)).toEqual<ParsedBlock[]>([
      { type: "tool_result", content: "oops", isError: false },
    ]);

    const both = JSON.stringify({ tool_use_result: { stdout: "out line", stderr: "err line" } });
    expect(parseClaudeOutput(both)).toEqual<ParsedBlock[]>([
      { type: "tool_result", content: "out line\nerr line", isError: false },
    ]);
  });

  it("marks the tool_result as an error when interrupted is true, even with normal stdout", () => {
    const line = JSON.stringify({
      tool_use_result: { stdout: "partial output", interrupted: true },
    });
    const result = parseClaudeOutput(line);
    expect(result).toHaveLength(1);
    expect(result[0]!.isError).toBe(true);
  });

  it("marks the tool_result as an error when stdout starts with 'Error'", () => {
    const line = JSON.stringify({ tool_use_result: { stdout: "Error: something broke" } });
    const result = parseClaudeOutput(line);
    expect(result[0]!.isError).toBe(true);
  });
});

describe("parseClaudeOutput – content_block_start with a non-tool_use block", () => {
  it("produces no block when content_block.type is not 'tool_use'", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "text" },
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });
});

describe("parseClaudeOutput – extractFromContentArray edge cases", () => {
  it("skips non-object items (primitives) within a content array", () => {
    const line = JSON.stringify({
      content: [42, "a string", null, { type: "text", text: "hi" }],
    });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([{ type: "text", content: "hi" }]);
  });

  it("JSON.stringifies a tool_result's content when it is an object", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: { ok: true }, is_error: false }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([
      { type: "tool_result", content: JSON.stringify({ ok: true }), isError: false },
    ]);
  });

  it("stringifies a tool_result's content via String() when it is a non-string, non-object primitive", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: 123, is_error: false }],
    });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([
      { type: "tool_result", content: "123", isError: false },
    ]);
  });

  it("produces no block for a content-array item whose type matches none of text/tool_use/tool_result", () => {
    const line = JSON.stringify({
      content: [{ type: "thinking", text: "internal reasoning" }],
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("falls back to an empty string when a tool_result has no content field at all", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", is_error: true }],
    });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([
      { type: "tool_result", content: "", isError: true },
    ]);
  });
});

describe("parseClaudeOutput – formatToolInput via tool_use blocks", () => {
  it("returns an empty string when a tool_use's input is not an object", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Bash", input: "not-an-object" }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([
      { type: "tool_use", content: "", toolName: "Bash" },
    ]);
  });

  it("falls back to the 'path' field when command/file_path are absent", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Read", input: { path: "/tmp/foo.txt" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]).toEqual<ParsedBlock>({
      type: "tool_use",
      content: "/tmp/foo.txt",
      toolName: "Read",
    });
  });

  it("returns a short 'content' field as-is, without truncation", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Write", input: { content: "short text" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]!.content).toBe("short text");
  });

  it("truncates a long 'content' field to 200 characters with an ellipsis", () => {
    const longContent = "x".repeat(250);
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Write", input: { content: longContent } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]!.content).toBe("x".repeat(200) + "…");
  });

  it("falls back to a short JSON summary when none of the known fields are present", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Custom", input: { foo: "bar" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]!.content).toBe(JSON.stringify({ foo: "bar" }));
  });

  it("truncates a long JSON summary fallback to 200 characters with an ellipsis", () => {
    const bigObj = { data: "y".repeat(250) };
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Custom", input: bigObj }],
    });
    const result = parseClaudeOutput(line);
    const expectedSummary = JSON.stringify(bigObj);
    expect(result[0]!.content).toBe(expectedSummary.slice(0, 200) + "…");
    expect(result[0]!.content.length).toBe(201);
  });
});
