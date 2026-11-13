import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

vi.mock("@/lib/parseClaudeOutput.ts", () => ({
  parseClaudeOutput: vi.fn(),
}));

import { parseClaudeOutput } from "@/lib/parseClaudeOutput.ts";

const mockParse = parseClaudeOutput as unknown as ReturnType<typeof vi.fn>;

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "claude",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  beforeEach(() => {
    mockParse.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the completed label when output exists but there is no active process", () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders the runtime/stage of the active process when one exists", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "claude-code", stage: "Implementing" })]}
        output=""
      />,
    );
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("toggles the collapsed state when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("Waiting for output...")).toBeNull();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("shows 'Waiting for output...' in parsed view when there are no blocks", () => {
    mockParse.mockReturnValue([]);
    render(<AgentOutputPanel processes={[]} output="raw text" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "Hello from parsed" }]);
    render(<AgentOutputPanel processes={[]} output="raw text content" />);

    expect(screen.getByText("Hello from parsed")).toBeDefined();
    expect(screen.getByText("raw")).toBeDefined();

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("raw text content")).toBeDefined();
    expect(screen.getByText("parsed")).toBeDefined();
    expect(screen.queryByText("Hello from parsed")).toBeNull();
  });

  it("shows 'Waiting for output...' in raw view when output is empty but a process is active", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders a text block", () => {
    mockParse.mockReturnValue([{ type: "text", content: "Plain text block" } as ParsedBlock]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Plain text block")).toBeDefined();
  });

  it("renders a tool_use block with its tool name and collapses/expands its content", async () => {
    mockParse.mockReturnValue([
      { type: "tool_use", content: "ls -la", toolName: "Bash" } as ParsedBlock,
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a successful tool_result block without the error label", () => {
    mockParse.mockReturnValue([
      { type: "tool_result", content: "it worked", isError: false } as ParsedBlock,
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("it worked")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders an error tool_result block with the error label", () => {
    mockParse.mockReturnValue([
      { type: "tool_result", content: "it failed", isError: true } as ParsedBlock,
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("it failed")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
  });

  it("renders an 'error' typed block", () => {
    mockParse.mockReturnValue([
      { type: "error", content: "fatal problem" } as ParsedBlock,
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("fatal problem")).toBeDefined();
  });

  it("renders a 'raw' typed block via the default renderer", () => {
    mockParse.mockReturnValue([
      { type: "raw", content: "unparsed fragment" } as ParsedBlock,
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("unparsed fragment")).toBeDefined();
  });

  it("renders the elapsed time for an active process and updates it as time passes", () => {
    vi.useFakeTimers();
    const start = new Date("2024-01-01T00:00:00Z");
    vi.setSystemTime(start);

    render(
      <AgentOutputPanel
        processes={[makeProcess({ startedAt: start.toISOString() })]}
        output=""
      />,
    );
    expect(screen.getByText("0s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText("5s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText("1m 10s")).toBeDefined();
  });

  it("auto-expands when a process transitions from inactive to active", async () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output="initial" />);
    // Manually collapse
    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("Waiting for output...")).toBeNull();

    // A process becomes active -> should auto re-expand
    rerender(<AgentOutputPanel processes={[makeProcess()]} output="initial" />);
    expect(await screen.findByText("Waiting for output...")).toBeDefined();
  });
});
