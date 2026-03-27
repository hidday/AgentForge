import { describe, it, expect } from "vitest";
import { parseClaudeOutput, type ParsedBlock } from "./parseClaudeOutput";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ndjoin = (...lines: string[]) => lines.join("\n");

// ---------------------------------------------------------------------------
// Empty / trivial inputs
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – empty/trivial inputs", () => {
  it("returns [] for an empty string", () => {
    expect(parseClaudeOutput("")).toEqual([]);
  });

  it("returns [] for a string of only whitespace", () => {
    expect(parseClaudeOutput("   \n\n  ")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Raw (non-JSON) lines
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – non-JSON lines fall through as 'raw'", () => {
  it("emits a raw block for a plain text line", () => {
    const result = parseClaudeOutput("hello world");
    expect(result).toEqual<ParsedBlock[]>([{ type: "raw", content: "hello world" }]);
  });

  it("emits a raw block for malformed JSON", () => {
    const result = parseClaudeOutput("{not valid json");
    expect(result).toEqual<ParsedBlock[]>([{ type: "raw", content: "{not valid json" }]);
  });

  it("handles mixed raw lines and JSON lines", () => {
    const raw = ndjoin(
      "plain line",
      JSON.stringify({ content: [{ type: "text", text: "hi" }] }),
    );
    const result = parseClaudeOutput(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual<ParsedBlock>({ type: "raw", content: "plain line" });
    expect(result[1]).toEqual<ParsedBlock>({ type: "text", content: "hi" });
  });
});

// ---------------------------------------------------------------------------
// Text blocks
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – text extraction", () => {
  it("extracts a text block from a content array", () => {
    const line = JSON.stringify({ content: [{ type: "text", text: "Hello" }] });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([{ type: "text", content: "Hello" }]);
  });

  it("merges adjacent text blocks into one", () => {
    const l1 = JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "foo " } });
    const l2 = JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "bar" } });
    const result = parseClaudeOutput(ndjoin(l1, l2));
    expect(result).toEqual<ParsedBlock[]>([{ type: "text", content: "foo bar" }]);
  });

  it("extracts text from content_block_delta streaming events", () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "streaming text" },
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([{ type: "text", content: "streaming text" }]);
  });

  it("ignores content_block_delta events with non-text-delta type", () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: "{" },
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tool use blocks
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – tool_use extraction", () => {
  it("extracts a tool_use block from a content array", () => {
    const line = JSON.stringify({
      content: [
        {
          type: "tool_use",
          name: "Bash",
          input: { command: "ls -la" },
        },
      ],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([
      { type: "tool_use", content: "ls -la", toolName: "Bash" },
    ]);
  });

  it("extracts a tool_use from content_block_start event", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Read", input: { file_path: "/tmp/foo.txt" } },
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([
      { type: "tool_use", content: "/tmp/foo.txt", toolName: "Read" },
    ]);
  });

  it("truncates long tool input with an ellipsis", () => {
    const longContent = "x".repeat(300);
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Write", input: { content: longContent } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toHaveLength(201); // 200 chars + "…"
    expect(result[0].content.endsWith("…")).toBe(true);
  });

  it("falls back to JSON summary for tool input without known fields", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Custom", input: { foo: "bar" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].type).toBe("tool_use");
    expect(result[0].content).toContain("foo");
  });
});

// ---------------------------------------------------------------------------
// Tool result blocks
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – tool_result extraction", () => {
  it("extracts a string tool_use_result", () => {
    const line = JSON.stringify({ tool_use_result: "done" });
    expect(parseClaudeOutput(line)).toEqual<ParsedBlock[]>([
      { type: "tool_result", content: "done", isError: false },
    ]);
  });

  it("marks a string tool_use_result starting with 'Error:' as an error", () => {
    const line = JSON.stringify({ tool_use_result: "Error: command not found" });
    const result = parseClaudeOutput(line);
    expect(result[0].isError).toBe(true);
  });

  it("extracts stdout/stderr from an object tool_use_result", () => {
    const line = JSON.stringify({
      tool_use_result: { stdout: "file.txt\n", stderr: "" },
    });
    const result = parseClaudeOutput(line);
    expect(result[0].type).toBe("tool_result");
    expect(result[0].content).toBe("file.txt");
    expect(result[0].isError).toBe(false);
  });

  it("marks an interrupted object tool_use_result as an error", () => {
    const line = JSON.stringify({
      tool_use_result: { stdout: "", stderr: "killed", interrupted: true },
    });
    const result = parseClaudeOutput(line);
    expect(result[0].isError).toBe(true);
  });

  it("skips object tool_use_result with no stdout/stderr content", () => {
    const line = JSON.stringify({ tool_use_result: { stdout: "  ", stderr: " " } });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("extracts tool_result from a bare content array", () => {
    const line = JSON.stringify([{ type: "tool_result", content: "ok", is_error: false }]);
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([
      { type: "tool_result", content: "ok", isError: false },
    ]);
  });

  it("marks is_error:true tool_result correctly", () => {
    const line = JSON.stringify([{ type: "tool_result", content: "boom", is_error: true }]);
    expect(parseClaudeOutput(line)[0].isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – edge cases", () => {
  it("handles a bare JSON array of mixed content types", () => {
    const line = JSON.stringify([
      { type: "text", text: "hello" },
      { type: "tool_use", name: "Grep", input: { query: "foo" } },
    ]);
    const result = parseClaudeOutput(line);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("tool_use");
  });

  it("skips blank lines between NDJSON records", () => {
    const raw = "\n\n" + JSON.stringify({ content: [{ type: "text", text: "x" }] }) + "\n\n";
    expect(parseClaudeOutput(raw)).toHaveLength(1);
  });

  it("does not merge a text block followed by a tool_use block", () => {
    const l1 = JSON.stringify({ content: [{ type: "text", text: "before" }] });
    const l2 = JSON.stringify({ content: [{ type: "tool_use", name: "Bash", input: { command: "pwd" } }] });
    const result = parseClaudeOutput(ndjoin(l1, l2));
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("tool_use");
  });

  it("handles a JSON object with no recognised fields gracefully (produces no block)", () => {
    const line = JSON.stringify({ unknown_field: 42 });
    expect(parseClaudeOutput(line)).toEqual([]);
  });
});
