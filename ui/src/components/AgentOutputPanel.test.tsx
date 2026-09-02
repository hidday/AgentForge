import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

vi.mock("@/lib/parseClaudeOutput.ts", () => ({
  parseClaudeOutput: vi.fn(),
}));

import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import { parseClaudeOutput } from "@/lib/parseClaudeOutput.ts";

const mockParse = parseClaudeOutput as unknown as ReturnType<typeof vi.fn>;

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 1234,
    command: "claude",
    runId: "run-1",
    stage: "executing",
    runtime: "claude",
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParse.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the completed label when there are no active processes but output exists", () => {
    mockParse.mockReturnValue([{ type: "text", content: "done" } as ParsedBlock]);
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the runtime, stage and a running elapsed timer for an active process", () => {
    vi.useFakeTimers();
    const proc = makeProcess({ runtime: "claude", stage: "executing" });
    render(<AgentOutputPanel processes={[proc]} output="" />);

    expect(screen.getByText("claude")).toBeDefined();
    expect(screen.getByText("executing")).toBeDefined();
    expect(screen.getByText("0s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(65_000);
    });

    expect(screen.getByText("1m 5s")).toBeDefined();
  });

  it("toggles between collapsed and expanded when the header is clicked", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "hello" } as ParsedBlock]);
    render(<AgentOutputPanel processes={[]} output="hello" />);

    // Expanded by default: the raw/parsed toggle is visible.
    expect(screen.getByText("raw")).toBeDefined();

    const header = screen.getByText("Agent Output (completed)").closest("button")!;
    await userEvent.click(header);
    expect(screen.queryByText("raw")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("raw")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "Hello agent" } as ParsedBlock]);
    render(<AgentOutputPanel processes={[]} output="raw ndjson output" />);

    expect(screen.getByText("Hello agent")).toBeDefined();

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("raw ndjson output")).toBeDefined();
    expect(screen.getByText("parsed")).toBeDefined();

    await userEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("Hello agent")).toBeDefined();
  });

  it("shows a waiting placeholder in both parsed and raw views when there is no output yet", async () => {
    mockParse.mockReturnValue([]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);

    expect(screen.getByText("Waiting for output...")).toBeDefined();

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders every block type with its distinct styling", async () => {
    mockParse.mockReturnValue([
      { type: "text", content: "Hello agent" },
      { type: "tool_use", toolName: "Bash", content: "ls -la" },
      { type: "tool_use", toolName: "Empty", content: "" },
      { type: "tool_result", content: "file.txt", isError: false },
      { type: "tool_result", content: "boom", isError: true },
      { type: "error", content: "Something broke" },
      { type: "raw", content: "raw passthrough line" },
    ] as ParsedBlock[]);

    render(<AgentOutputPanel processes={[]} output="anything" />);

    expect(screen.getByText("Hello agent")).toBeDefined();

    // tool_use with content: expanded by default, shows its command.
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    // tool_use with empty content never shows a pre block, even expanded.
    expect(screen.getByText("Empty")).toBeDefined();
    expect(screen.queryByText("", { selector: "pre" })).toBeNull();

    // tool_result success (no "Error" label) vs failure (with "Error" label).
    expect(screen.getByText("file.txt")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();

    // error block
    expect(screen.getByText("Something broke")).toBeDefined();

    // unrecognised/raw block falls through to the default renderer
    expect(screen.getByText("raw passthrough line")).toBeDefined();

    // Collapsing a tool_use block hides its content, expanding shows it again.
    const toolButton = screen.getByText("Bash").closest("button")!;
    await userEvent.click(toolButton);
    expect(screen.queryByText("ls -la")).toBeNull();
    await userEvent.click(toolButton);
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("auto-expands a previously collapsed panel when a process becomes active", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "content" } as ParsedBlock]);
    const { rerender } = render(<AgentOutputPanel processes={[]} output="content" />);

    const header = screen.getByText("Agent Output (completed)").closest("button")!;
    await userEvent.click(header);
    expect(screen.queryByText("raw")).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output="content" />);

    await waitFor(() => {
      expect(screen.queryByText("raw")).not.toBeNull();
    });
  });
});
