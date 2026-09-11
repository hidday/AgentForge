import { describe, it, expect } from "vitest";
import { parseClaudeOutput } from "./parseClaudeOutput.ts";

describe("parseClaudeOutput – top-level line shape branches", () => {
  it("ignores a line whose parsed JSON is a primitive, not an object or array", () => {
    const result = parseClaudeOutput("42");
    expect(result).toHaveLength(0);
  });

  it("ignores a tool_use_result that is neither a string nor an object (e.g. a number)", () => {
    const line = JSON.stringify({ tool_use_result: 7 });
    const result = parseClaudeOutput(line);
    expect(result).toHaveLength(0);
  });

  it("ignores a content_block_start event whose content_block is not a tool_use", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "text", text: "not a tool" },
    });
    const result = parseClaudeOutput(line);
    expect(result).toHaveLength(0);
  });

  it("skips a content-array item whose type is none of text/tool_use/tool_result", () => {
    const line = JSON.stringify({
      content: [{ type: "thinking", text: "internal reasoning" }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toHaveLength(0);
  });
});

describe("parseClaudeOutput – formatToolInput field coverage", () => {
  it("uses the 'path' field when present", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Glob", input: { path: "/tmp/dir" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]).toMatchObject({ type: "tool_use", content: "/tmp/dir", toolName: "Glob" });
  });

  it("returns a short content field as-is, without truncation", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Write", input: { content: "short text" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]).toMatchObject({ type: "tool_use", content: "short text", toolName: "Write" });
  });

  it("returns an empty string when the tool input is not an object (e.g. null)", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "NoArgsTool", input: null }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]).toMatchObject({ type: "tool_use", content: "", toolName: "NoArgsTool" });
  });

  it("truncates a JSON.stringify fallback summary longer than 200 chars", () => {
    const bigInput = { unknownField: "x".repeat(250) };
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "WeirdTool", input: bigInput }],
    });
    const result = parseClaudeOutput(line);
    const content = result[0]!.content;
    expect(content.endsWith("…")).toBe(true);
    expect(content.length).toBe(201);
  });
});

describe("parseClaudeOutput – extractFromContentArray item filtering", () => {
  it("skips non-object items (e.g. a stray string) in a content array", () => {
    const line = JSON.stringify({
      content: ["a stray string entry", { type: "text", text: "real block" }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "text", content: "real block" });
  });

  it("skips null items in a content array", () => {
    const line = JSON.stringify({
      content: [null, { type: "text", text: "real block" }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "text", content: "real block" });
  });

  it("stringifies a non-string, non-object tool_result content value (e.g. a number)", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: 42 }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]).toMatchObject({ type: "tool_result", content: "42" });
  });

  it("falls back to an empty string for a tool_result with no content field at all", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result" }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]).toMatchObject({ type: "tool_result", content: "" });
  });

  it("JSON.stringifies an object tool_result content value", () => {
    const line = JSON.stringify({
      content: [
        {
          type: "tool_result",
          content: { stdout: "file.txt", stderr: "" },
        },
      ],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]).toMatchObject({
      type: "tool_result",
      content: JSON.stringify({ stdout: "file.txt", stderr: "" }),
    });
  });
});
