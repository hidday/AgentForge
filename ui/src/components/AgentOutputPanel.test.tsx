import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

const mockParse = vi.fn<(output: string) => ParsedBlock[]>();
vi.mock("@/lib/parseClaudeOutput.ts", () => ({
  parseClaudeOutput: (output: string) => mockParse(output),
}));

import { AgentOutputPanel } from "./AgentOutputPanel.tsx";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
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
    mockParse.mockReset();
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

  it("renders the runtime, stage and an active pulse dot when a process is active", () => {
    const { container } = render(
      <AgentOutputPanel processes={[makeProcess()]} output="" />,
    );
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("ticks the elapsed timer for an active process", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    render(
      <AgentOutputPanel
        processes={[makeProcess({ startedAt: "2024-01-01T00:00:00Z" })]}
        output=""
      />,
    );
    expect(screen.getByText("0s")).toBeDefined();
    vi.setSystemTime(new Date("2024-01-01T00:01:05Z"));
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    // advanceTimersByTime both fires the pending interval tick and moves the
    // already-overridden system clock forward by the same delta.
    expect(screen.getByText("1m 6s")).toBeDefined();
  });

  it("shows the waiting placeholder when there are no parsed blocks", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders a text block", () => {
    mockParse.mockReturnValue([{ type: "text", content: "hello from agent" }]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
    expect(screen.getByText("hello from agent")).toBeDefined();
  });

  it("renders a tool_use block and toggles its expanded content on click", async () => {
    mockParse.mockReturnValue([
      { type: "tool_use", content: "ls -la", toolName: "Bash" },
    ]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a successful tool_result block without the error banner", () => {
    mockParse.mockReturnValue([
      { type: "tool_result", content: "ok", isError: false },
    ]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
    expect(screen.getByText("ok")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders a failing tool_result block with the error banner", () => {
    mockParse.mockReturnValue([
      { type: "tool_result", content: "boom", isError: true },
    ]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
  });

  it("renders an error block", () => {
    mockParse.mockReturnValue([{ type: "error", content: "something failed" }]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
    expect(screen.getByText("something failed")).toBeDefined();
  });

  it("renders raw/unknown blocks as plain muted text", () => {
    mockParse.mockReturnValue([{ type: "raw", content: "raw line" }]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
    expect(screen.getByText("raw line")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "parsed text" }]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="raw output text" />);
    expect(screen.getByText("parsed text")).toBeDefined();
    expect(screen.queryByText("raw output text")).toBeNull();

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("raw output text")).toBeDefined();
    expect(screen.queryByText("parsed text")).toBeNull();

    await userEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("parsed text")).toBeDefined();
  });

  it("collapses and expands the panel body on header click", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "visible text" }]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
    expect(screen.getByText("visible text")).toBeDefined();

    await userEvent.click(screen.getByText("claude-code"));
    expect(screen.queryByText("visible text")).toBeNull();

    await userEvent.click(screen.getByText("claude-code"));
    expect(screen.getByText("visible text")).toBeDefined();
  });
});
