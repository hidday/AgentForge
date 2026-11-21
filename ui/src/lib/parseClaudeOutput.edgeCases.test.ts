// Supplementary parseClaudeOutput coverage: primitive JSON lines, noise-line
// heuristics, tool input formatting variants and odd tool_result payloads.
import { describe, it, expect } from "vitest";
import { parseClaudeOutput } from "./parseClaudeOutput.ts";

const j = (o: unknown) => JSON.stringify(o);
const toolUse = (input: unknown) =>
  parseClaudeOutput(j({ content: [{ type: "tool_use", name: "T", input }] }))[0]!;

describe("parseClaudeOutput edge cases", () => {
  it("drops truthy primitive JSON lines but keeps falsy ones as raw text", () => {
    expect(parseClaudeOutput("42\ntrue\n\"quoted\"")).toEqual([]);
    // tryParseJSON yields a falsy value for 0, so the line is treated as raw
    expect(parseClaudeOutput("0")).toEqual([{ type: "raw", content: "0" }]);
  });

  it("ignores non-string, non-object tool_use_result values and empty stdout/stderr", () => {
    expect(parseClaudeOutput(j({ tool_use_result: 5 }))).toEqual([]);
    expect(parseClaudeOutput(j({ tool_use_result: null }))).toEqual([]);
    expect(parseClaudeOutput(j({ tool_use_result: { stdout: "  ", stderr: "" } }))).toEqual([]);
  });

  it("combines stdout and stderr and flags interrupted or Error-prefixed output", () => {
    expect(parseClaudeOutput(j({ tool_use_result: { stdout: "out", stderr: "err" } }))).toEqual([
      { type: "tool_result", content: "out\nerr", isError: false },
    ]);
    expect(parseClaudeOutput(j({ tool_use_result: { stderr: "x", interrupted: true } }))[0]!.isError).toBe(true);
    expect(parseClaudeOutput(j({ tool_use_result: { stdout: "Error here" } }))[0]!.isError).toBe(true);
  });

  it("ignores content_block_start blocks that are not tool_use and deltas that are not text", () => {
    expect(parseClaudeOutput(j({ type: "content_block_start", content_block: { type: "text", text: "x" } }))).toEqual([]);
    expect(parseClaudeOutput(j({ type: "content_block_start", content_block: { type: "tool_use" } }))).toEqual([]);
    expect(parseClaudeOutput(j({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{" } }))).toEqual([]);
  });

  it("treats split metadata fragments as noise only when the full signature matches", () => {
    expect(parseClaudeOutput('"parent_tool_use_id": null, "session_id": "abc"')).toEqual([]);
    expect(parseClaudeOutput('"parent_tool_use_id": null, other')).toEqual([
      { type: "raw", content: '"parent_tool_use_id": null, other' },
    ]);
    expect(parseClaudeOutput('"stop_reason": null, "stop_sequence": null')).toEqual([]);
    expect(parseClaudeOutput('"stop_reason": null, more')).toEqual([
      { type: "raw", content: '"stop_reason": null, more' },
    ]);
  });

  it("skips non-object entries and unknown types in content arrays", () => {
    expect(
      parseClaudeOutput(j([null, "str", 3, { type: "image" }, { type: "text", text: "kept" }])),
    ).toEqual([{ type: "text", content: "kept" }]);
  });

  it("stringifies tool_result content of various shapes", () => {
    const out = parseClaudeOutput(
      j({
        content: [
          { type: "tool_result", content: [{ type: "text", text: "a" }] },
          { type: "tool_result", content: 7 },
          { type: "tool_result" },
        ],
      }),
    );
    expect(out.map((b) => b.content)).toEqual(['[{"type":"text","text":"a"}]', "7", ""]);
    expect(out.every((b) => b.isError === false)).toBe(true);
  });

  it("formats tool input by preferring command, file_path, path, query, then content", () => {
    expect(toolUse({ command: "ls", path: "x" }).content).toBe("ls");
    expect(toolUse({ file_path: "/a", path: "x" }).content).toBe("/a");
    expect(toolUse({ path: "/dir", query: "q" }).content).toBe("/dir");
    expect(toolUse({ query: "find me" }).content).toBe("find me");
    expect(toolUse({ content: "short" }).content).toBe("short");
    expect(toolUse({ content: "y".repeat(201) }).content).toBe("y".repeat(200) + "…");
    expect(toolUse({ content: "z".repeat(200) }).content).toBe("z".repeat(200));
  });

  it("falls back to JSON for other inputs, truncating long ones, and empty for non-objects", () => {
    expect(toolUse({ a: 1 }).content).toBe('{"a":1}');
    const long = toolUse({ blob: "b".repeat(300) }).content;
    expect(long).toHaveLength(201);
    expect(long.endsWith("…")).toBe(true);
    expect(toolUse("string input").content).toBe("");
    expect(toolUse(undefined).content).toBe("");
  });

  it("merges only adjacent text blocks", () => {
    const out = parseClaudeOutput(
      [
        j({ type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } }),
        j({ type: "content_block_delta", delta: { type: "text_delta", text: "lo" } }),
        "raw between",
        j({ type: "content_block_delta", delta: { type: "text_delta", text: "Bye" } }),
      ].join("\n"),
    );
    expect(out).toEqual([
      { type: "text", content: "Hello" },
      { type: "raw", content: "raw between" },
      { type: "text", content: "Bye" },
    ]);
  });
});
