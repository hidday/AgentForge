export interface ParsedBlock {
  type: "text" | "tool_use" | "tool_result" | "error" | "raw";
  content: string;
  toolName?: string;
  isError?: boolean;
}

const SKIP_EVENT_TYPES = new Set([
  "message_start",
  "message_delta",
  "message_stop",
  "ping",
  "content_block_stop",
  "result",
]);

const METADATA_NOISE_RE =
  /"(?:input_tokens|output_tokens|service_tier|cache_creation_input_tokens|cache_read_input_tokens|inference_geo|context_management|ephemeral_\w+_input_tokens|output_style|claude_code_version|apiKeySource|fast_mode_state)"\s*:/;

/**
 * Parses the raw NDJSON output from Claude Code CLI (--output-format stream-json --verbose)
 * and extracts only the human-relevant content: text, tool calls, tool results, and errors.
 * Filters out API metadata (usage, tokens, service_tier, etc.) and Claude Code wrapper noise.
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
      if (!isNoiseLine(trimmed)) {
        blocks.push({ type: "raw", content: trimmed });
      }
      continue;
    }

    if (Array.isArray(parsed)) {
      extractFromContentArray(parsed, blocks);
      continue;
    }

    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;

      if (isSkippableEvent(obj)) continue;

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

/**
 * Returns true if a complete JSON object is a metadata/system event
 * that carries no user-facing content.
 */
function isSkippableEvent(obj: Record<string, unknown>): boolean {
  const eventType = typeof obj.type === "string" ? obj.type : "";
  if (SKIP_EVENT_TYPES.has(eventType)) return true;

  if (obj.output_style !== undefined || obj.claude_code_version !== undefined) return true;

  const hasContentFields =
    Array.isArray(obj.content) ||
    obj.tool_use_result !== undefined ||
    obj.content_block !== undefined ||
    (eventType === "content_block_delta" && obj.delta !== undefined);

  if (hasContentFields) return false;

  if (obj.usage !== undefined) return true;
  if (obj.session_id !== undefined && obj.uuid !== undefined) return true;

  return false;
}

/**
 * Returns true if a non-JSON line is a fragment of API metadata
 * rather than meaningful agent output. These appear when SSE chunks
 * split NDJSON lines at arbitrary byte boundaries.
 */
function isNoiseLine(line: string): boolean {
  if (METADATA_NOISE_RE.test(line)) return true;

  if (
    /"parent_tool_use_id"\s*:/.test(line) &&
    /"session_id"\s*:/.test(line)
  ) {
    return true;
  }

  if (
    /"stop_reason"\s*:\s*null/.test(line) &&
    /"stop_sequence"\s*:\s*null/.test(line)
  ) {
    return true;
  }

  return false;
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
