export interface ParsedBlock {
  type: "text" | "tool_use" | "tool_result" | "error" | "raw";
  content: string;
  toolName?: string;
  isError?: boolean;
}

/**
 * Parses the raw NDJSON output from Claude Code CLI (--output-format stream-json --verbose)
 * and extracts only the human-relevant content: text, tool calls, tool results, and errors.
 */
export function parseClaudeOutput(raw: string): ParsedBlock[] {
  if (!raw) return [];

  const blocks: ParsedBlock[] = [];
  const lines = raw.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parsed = tryParseJSON(trimmed);
    if (!parsed) {
      blocks.push({ type: "raw", content: trimmed });
      continue;
    }

    // Claude Code wraps events in objects with "content" arrays and metadata.
    // We also see bare arrays for tool_result messages.
    if (Array.isArray(parsed)) {
      extractFromContentArray(parsed, blocks);
      continue;
    }

    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;

      // Top-level tool_use_result field (Claude Code wrapper)
      if (obj.tool_use_result !== undefined) {
        const result = obj.tool_use_result;
        if (typeof result === "string") {
          blocks.push({
            type: "tool_result",
            content: result,
            isError: result.startsWith("Error:"),
          });
        } else if (typeof result === "object" && result !== null) {
          const r = result as Record<string, unknown>;
          const parts: string[] = [];
          if (typeof r.stdout === "string" && r.stdout.trim()) parts.push(r.stdout.trim());
          if (typeof r.stderr === "string" && r.stderr.trim()) parts.push(r.stderr.trim());
          if (parts.length > 0) {
            blocks.push({
              type: "tool_result",
              content: parts.join("\n"),
              isError: r.interrupted === true || (typeof r.stdout === "string" && r.stdout.startsWith("Error")),
            });
          }
        }
        continue;
      }

      // "content" array on the event object
      if (Array.isArray(obj.content)) {
        extractFromContentArray(obj.content as unknown[], blocks);
        continue;
      }

      // Streaming delta events
      if (obj.type === "content_block_delta" && typeof obj.delta === "object" && obj.delta !== null) {
        const delta = obj.delta as Record<string, unknown>;
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          blocks.push({ type: "text", content: delta.text });
        }
        continue;
      }

      // Content block start with initial tool_use
      if (obj.type === "content_block_start" && typeof obj.content_block === "object" && obj.content_block !== null) {
        const cb = obj.content_block as Record<string, unknown>;
        if (cb.type === "tool_use" && typeof cb.name === "string") {
          blocks.push({
            type: "tool_use",
            content: formatToolInput(cb.input),
            toolName: cb.name,
          });
        }
      }
    }
  }

  return mergeAdjacentText(blocks);
}

function extractFromContentArray(arr: unknown[], blocks: ParsedBlock[]): void {
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;

    if (entry.type === "text" && typeof entry.text === "string") {
      blocks.push({ type: "text", content: entry.text });
    } else if (entry.type === "tool_use" && typeof entry.name === "string") {
      blocks.push({
        type: "tool_use",
        content: formatToolInput(entry.input),
        toolName: entry.name,
      });
    } else if (entry.type === "tool_result") {
      const isError = entry.is_error === true;
      const content =
        typeof entry.content === "string"
          ? entry.content
          : typeof entry.content === "object"
            ? JSON.stringify(entry.content)
            : String(entry.content ?? "");
      blocks.push({ type: "tool_result", content, isError });
    }
  }
}

function formatToolInput(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const obj = input as Record<string, unknown>;

  if (typeof obj.command === "string") return obj.command;
  if (typeof obj.file_path === "string") return obj.file_path;
  if (typeof obj.path === "string") return obj.path;
  if (typeof obj.query === "string") return obj.query;
  if (typeof obj.content === "string") {
    return obj.content.length > 200 ? obj.content.slice(0, 200) + "…" : obj.content;
  }

  const summary = JSON.stringify(obj);
  return summary.length > 200 ? summary.slice(0, 200) + "…" : summary;
}

function mergeAdjacentText(blocks: ParsedBlock[]): ParsedBlock[] {
  const merged: ParsedBlock[] = [];
  for (const block of blocks) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === "text" && block.type === "text") {
      prev.content += block.content;
    } else {
      merged.push({ ...block });
    }
  }
  return merged;
}

function tryParseJSON(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
