import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";

// parseClaudeOutput never actually emits a "type: error" ParsedBlock today
// (it's part of the ParsedBlock union for forward-compatibility), so to
// exercise AgentOutputPanel's dedicated error-block rendering branch we wrap
// the real parser and inject one for a sentinel input, leaving all other
// inputs to flow through the real implementation unchanged.
vi.mock("@/lib/parseClaudeOutput.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/parseClaudeOutput.ts")>();
  return {
    ...actual,
    parseClaudeOutput: (raw: string) => {
      if (raw === "__INJECT_ERROR_BLOCK__") {
        return [{ type: "error" as const, content: "Fatal failure" }];
      }
      return actual.parseClaudeOutput(raw);
    },
  };
});

import { AgentOutputPanel } from "./AgentOutputPanel.tsx";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 1234,
    command: "claude",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

const textLine = (text: string) =>
  JSON.stringify({ content: [{ type: "text", text }] });
const toolUseLine = (name: string, input: Record<string, unknown>) =>
  JSON.stringify({ content: [{ type: "tool_use", name, input }] });
const toolResultLine = (content: string, isError: boolean) =>
  JSON.stringify({ content: [{ type: "tool_result", content, is_error: isError }] });

describe("AgentOutputPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the completed header when output exists but there is no active process", () => {
    render(<AgentOutputPanel processes={[]} output={textLine("done")} />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders process info (runtime, stage, elapsed timer) when a process is active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:10Z"));
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "claude", stage: "Implementing", startedAt: "2024-01-01T00:00:00Z" })]}
        output=""
      />,
    );
    expect(screen.getByText("claude")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("10s")).toBeDefined();
  });

  it("formats elapsed time with minutes once past 60 seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:02:05Z"));
    render(
      <AgentOutputPanel
        processes={[makeProcess({ startedAt: "2024-01-01T00:00:00Z" })]}
        output=""
      />,
    );
    expect(screen.getByText("2m 5s")).toBeDefined();
  });

  it("shows the 'Waiting for output...' placeholder in parsed view when active with no output", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles collapsed state when the header button is clicked", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output={textLine("hello")} />);

    expect(screen.getByText("hello")).toBeDefined();

    const headerBtn = screen.getByRole("button", { name: /Implementing/i });
    await userEvent.click(headerBtn);

    expect(screen.queryByText("hello")).toBeNull();

    await userEvent.click(headerBtn);
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    const raw = textLine("parsed text content");
    render(<AgentOutputPanel processes={[makeProcess()]} output={raw} />);

    // Parsed view by default
    expect(screen.getByText("parsed text content")).toBeDefined();

    const toggleBtn = screen.getByRole("button", { name: "raw" });
    await userEvent.click(toggleBtn);

    // Raw view shows the literal NDJSON text, not the parsed text
    expect(screen.queryByText("parsed text content")).toBeNull();
    expect(screen.getByText(raw)).toBeDefined();
    expect(screen.getByRole("button", { name: "parsed" })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "parsed" }));
    expect(screen.getByText("parsed text content")).toBeDefined();
  });

  it("shows the raw-view placeholder when output is empty", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByRole("button", { name: "raw" }));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders a text block", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output={textLine("Hello from agent")} />);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("renders a tool_use block, expanded by default, and toggles collapse on click", async () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess()]}
        output={toolUseLine("Bash", { command: "ls -la" })}
      />,
    );

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a successful tool_result block without an error label", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess()]}
        output={toolResultLine("Command succeeded", false)}
      />,
    );
    expect(screen.getByText("Command succeeded")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders a failing tool_result block with an error label", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess()]}
        output={toolResultLine("Command failed", true)}
      />,
    );
    expect(screen.getByText("Command failed")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
  });

  it("renders a raw fallback block (not a dedicated error block) for an 'Error:' line, since the parser emits type 'raw'", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess()]}
        output="Error: something went wrong"
      />,
    );
    expect(screen.getByText("Error: something went wrong")).toBeDefined();
  });

  it("renders the dedicated error block styling for a ParsedBlock of type 'error'", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess()]}
        output="__INJECT_ERROR_BLOCK__"
      />,
    );
    const errorText = screen.getByText("Fatal failure");
    expect(errorText.className).toContain("whitespace-pre-wrap");
    // The error block's wrapper applies the red error styling.
    expect(errorText.closest("div")?.className).toContain("text-red-400");
  });

  it("renders a raw fallback block for an unrecognized plain-text line", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess()]}
        output="just some plain unstructured output"
      />,
    );
    expect(screen.getByText("just some plain unstructured output")).toBeDefined();
  });

  it("re-expands automatically when a process transitions from inactive to active", async () => {
    const { rerender } = render(
      <AgentOutputPanel processes={[]} output={textLine("initial output")} />,
    );

    // Collapse the panel manually while inactive
    const headerBtn = screen.getByRole("button", { name: /Agent Output \(completed\)/i });
    await userEvent.click(headerBtn);
    expect(screen.queryByText("initial output")).toBeNull();

    // Now a process becomes active
    rerender(
      <AgentOutputPanel
        processes={[makeProcess()]}
        output={textLine("initial output")}
      />,
    );

    expect(screen.getByText("initial output")).toBeDefined();
  });

  it("renders multiple distinct block types together in order", () => {
    const output = [
      textLine("Starting task"),
      toolUseLine("Read", { file_path: "/tmp/file.txt" }),
      toolResultLine("file contents", false),
    ].join("\n");

    const { container } = render(
      <AgentOutputPanel processes={[makeProcess()]} output={output} />,
    );

    expect(within(container).getByText("Starting task")).toBeDefined();
    expect(within(container).getByText("Read")).toBeDefined();
    expect(within(container).getByText("/tmp/file.txt")).toBeDefined();
    expect(within(container).getByText("file contents")).toBeDefined();
  });
});
