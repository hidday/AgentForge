import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

const parseClaudeOutput = vi.fn<(raw: string) => ParsedBlock[]>();
vi.mock("@/lib/parseClaudeOutput.ts", () => ({
  parseClaudeOutput: (raw: string) => parseClaudeOutput(raw),
}));

import { AgentOutputPanel } from "./AgentOutputPanel.tsx";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 123,
    command: "claude",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  beforeEach(() => {
    parseClaudeOutput.mockReset();
    parseClaudeOutput.mockReturnValue([]);
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the completed label when output exists but no process is active", () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows runtime, stage, and an elapsed timer when a process is active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:10Z"));
    try {
      render(
        <AgentOutputPanel
          processes={[makeProcess({ runtime: "codex", stage: "Planning" })]}
          output=""
        />,
      );
      expect(screen.getByText("codex")).toBeDefined();
      expect(screen.getByText("Planning")).toBeDefined();
      // started at :00, system time is :10 -> 10s elapsed
      expect(screen.getByText("10s")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("formats elapsed time in minutes and seconds past the first minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:01:05Z"));
    try {
      render(
        <AgentOutputPanel processes={[makeProcess({ startedAt: "2024-01-01T00:00:00Z" })]} output="" />,
      );
      expect(screen.getByText("1m 5s")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("toggles the body open/closed when the header is clicked", () => {
    parseClaudeOutput.mockReturnValue([{ type: "text", content: "hello" }]);
    render(<AgentOutputPanel processes={[]} output="hello" />);

    expect(screen.getByText("hello")).toBeDefined();
    fireEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("hello")).toBeNull();

    fireEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("re-expands automatically when a new process becomes active", () => {
    parseClaudeOutput.mockReturnValue([{ type: "text", content: "hello" }]);
    const { rerender } = render(<AgentOutputPanel processes={[]} output="hello" />);

    fireEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("hello")).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output="hello" />);
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("shows the waiting placeholder when there are no parsed blocks", () => {
    parseClaudeOutput.mockReturnValue([]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles between parsed and raw views", () => {
    parseClaudeOutput.mockReturnValue([{ type: "text", content: "parsed text" }]);
    render(<AgentOutputPanel processes={[]} output='{"raw":"json"}' />);

    expect(screen.getByText("parsed text")).toBeDefined();
    const toggle = screen.getByText("raw");
    fireEvent.click(toggle);

    expect(screen.queryByText("parsed text")).toBeNull();
    expect(screen.getByText('{"raw":"json"}')).toBeDefined();
    expect(screen.getByText("parsed")).toBeDefined();
  });

  it("expands and collapses a tool_use block's content", () => {
    parseClaudeOutput.mockReturnValue([
      { type: "tool_use", toolName: "Bash", content: "ls -la" },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);

    expect(screen.getByText("ls -la")).toBeDefined();
    fireEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    fireEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a tool_result error block with the Error banner", () => {
    parseClaudeOutput.mockReturnValue([
      { type: "tool_result", content: "it broke", isError: true },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("it broke")).toBeDefined();
  });

  it("renders a successful tool_result block without the Error banner", () => {
    parseClaudeOutput.mockReturnValue([
      { type: "tool_result", content: "it worked", isError: false },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.queryByText("Error")).toBeNull();
    expect(screen.getByText("it worked")).toBeDefined();
  });

  it("renders a standalone error block", () => {
    parseClaudeOutput.mockReturnValue([{ type: "error", content: "fatal failure" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("fatal failure")).toBeDefined();
  });

  it("renders a raw fallback block", () => {
    parseClaudeOutput.mockReturnValue([{ type: "raw", content: "unrecognized line" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("unrecognized line")).toBeDefined();
  });
});
