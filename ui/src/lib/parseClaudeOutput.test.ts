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
// Metadata / noise filtering
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – metadata event filtering", () => {
  it("skips message_start events", () => {
    const line = JSON.stringify({
      type: "message_start",
      message: { id: "msg_123", model: "claude-sonnet-4-20250514", usage: { input_tokens: 100 } },
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("skips message_delta events", () => {
    const line = JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 50 },
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("skips message_stop events", () => {
    const line = JSON.stringify({ type: "message_stop" });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("skips ping events", () => {
    const line = JSON.stringify({ type: "ping" });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("skips content_block_stop events", () => {
    const line = JSON.stringify({ type: "content_block_stop", index: 0 });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("skips result events", () => {
    const line = JSON.stringify({
      type: "result",
      result: "Some long agent output text...",
      cost_usd: 0.01,
      duration_ms: 5000,
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("skips Claude Code init/config objects", () => {
    const line = JSON.stringify({
      output_style: "default",
      claude_code_version: "2.1.81",
      agents: ["general-purpose", "Explore", "Plan"],
      skills: ["update-config", "debug"],
      uuid: "21383d10-c2c9-4326-8508-262e93e08f30",
      fast_mode_state: "off",
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("skips objects with usage metadata but no content", () => {
    const line = JSON.stringify({
      usage: { input_tokens: 2, output_tokens: 8 },
      stop_reason: null,
      session_id: "abc",
      uuid: "def",
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("skips Claude Code wrapper envelopes with session_id/uuid but no content", () => {
    const line = JSON.stringify({
      parent_tool_use_id: null,
      session_id: "d19e3ded-9f7d-46a5-bd1c-54076a84746a",
      uuid: "65be793d-b2cc-4793-b32f-ca946c80a4e3",
      timestamp: "2026-03-29T13:02:31.411Z",
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("does NOT skip wrapper events that have a content array", () => {
    const line = JSON.stringify({
      content: [{ type: "text", text: "Hello from agent" }],
      stop_reason: null,
      usage: { input_tokens: 100 },
      session_id: "abc",
      uuid: "def",
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([{ type: "text", content: "Hello from agent" }]);
  });

  it("does NOT skip wrapper events that have tool_use_result", () => {
    const line = JSON.stringify({
      tool_use_result: "file.txt",
      session_id: "abc",
      uuid: "def",
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([
      { type: "tool_result", content: "file.txt", isError: false },
    ]);
  });

  it("does NOT skip wrapper events that have content_block", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Bash", input: { command: "ls" } },
      session_id: "abc",
      uuid: "def",
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([
      { type: "tool_use", content: "ls", toolName: "Bash" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Partial-line noise filtering (SSE chunk boundaries)
// ---------------------------------------------------------------------------
describe("parseClaudeOutput – partial line noise filtering", () => {
  it("filters partial JSON lines containing token metadata", () => {
    const fragment =
      'xgBagQ=="}],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":6780,"output_tokens":8,"service_tier":"standard","inference_geo":"not_available"}}';
    expect(parseClaudeOutput(fragment)).toEqual([]);
  });

  it("filters partial lines with output_style / claude_code_version", () => {
    const fragment =
      'mands":["update-config"],"apiKeySource":"none","claude_code_version":"2.1.81","output_style":"default"}';
    expect(parseClaudeOutput(fragment)).toEqual([]);
  });

  it("filters partial lines with parent_tool_use_id + session_id", () => {
    const fragment =
      '","is_error":false}]},"parent_tool_use_id":"toolu_019aPpT5qgpzuEuRoHbbLrDY","session_id":"d19e3ded-9f7d-46a5-bd1c-54076a84746a","uuid":"abc"}';
    expect(parseClaudeOutput(fragment)).toEqual([]);
  });

  it("filters partial lines with stop_reason:null + stop_sequence:null", () => {
    const fragment =
      'parser"},"caller":{"type":"direct"}}],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":2}}';
    expect(parseClaudeOutput(fragment)).toEqual([]);
  });

  it("keeps genuine non-JSON raw lines", () => {
    const result = parseClaudeOutput("Error: command not found");
    expect(result).toEqual<ParsedBlock[]>([{ type: "raw", content: "Error: command not found" }]);
  });

  it("keeps plain text raw lines", () => {
    const result = parseClaudeOutput("Processing files...");
    expect(result).toEqual<ParsedBlock[]>([{ type: "raw", content: "Processing files..." }]);
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

  it("filters metadata from a mixed stream of content and noise", () => {
    const raw = ndjoin(
      JSON.stringify({ type: "message_start", message: { id: "msg_1", model: "claude-sonnet-4-20250514" } }),
      JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } }),
      JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "world" } }),
      JSON.stringify({ type: "content_block_stop", index: 0 }),
      JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } }),
      JSON.stringify({ type: "message_stop" }),
    );
    const result = parseClaudeOutput(raw);
    expect(result).toEqual<ParsedBlock[]>([{ type: "text", content: "Hello world" }]);
  });
});
