import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AgentOutputPanel } from "./AgentOutputPanel";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

let mockBlocks: ParsedBlock[] = [];
vi.mock("@/lib/parseClaudeOutput.ts", () => ({
  parseClaudeOutput: () => mockBlocks,
}));

const proc: ActiveProcess = {
  id: "p1",
  pid: 1,
  command: "run",
  runId: "r1",
  stage: "Implementing",
  runtime: "claude-code",
  startedAt: "2026-01-01T00:00:00.000Z",
  elapsedMs: 0,
};

describe("AgentOutputPanel", () => {
  beforeEach(() => {
    mockBlocks = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a completed label when output exists but no process is active", () => {
    mockBlocks = [{ type: "text", content: "done" }];
    render(<AgentOutputPanel processes={[]} output="done" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the runtime, stage, and a pulsing indicator for an active process", () => {
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("shows an elapsed timer under a minute in seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
    render(<AgentOutputPanel processes={[proc]} output="" />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByText("5s")).toBeDefined();
  });

  it("shows an elapsed timer over a minute as minutes and seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:01:05.000Z"));
    render(<AgentOutputPanel processes={[proc]} output="" />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByText("1m 5s")).toBeDefined();
  });

  it("ticks the elapsed timer forward every second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    render(<AgentOutputPanel processes={[proc]} output="" />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText("3s")).toBeDefined();
  });

  it("shows a waiting placeholder when there are no parsed blocks", () => {
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders a text block", () => {
    mockBlocks = [{ type: "text", content: "hello there" }];
    render(<AgentOutputPanel processes={[proc]} output="x" />);
    expect(screen.getByText("hello there")).toBeDefined();
  });

  it("renders a tool_use block with a toggleable content section", () => {
    mockBlocks = [{ type: "tool_use", toolName: "Bash", content: "ls -la" }];
    render(<AgentOutputPanel processes={[proc]} output="x" />);
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    fireEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    fireEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a tool_use block with no content without a details section", () => {
    mockBlocks = [{ type: "tool_use", toolName: "Read", content: "" }];
    render(<AgentOutputPanel processes={[proc]} output="x" />);
    expect(screen.getByText("Read")).toBeDefined();
  });

  it("renders a successful tool_result block", () => {
    mockBlocks = [{ type: "tool_result", content: "ok", isError: false }];
    render(<AgentOutputPanel processes={[proc]} output="x" />);
    expect(screen.getByText("ok")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders a failing tool_result block with an error marker", () => {
    mockBlocks = [{ type: "tool_result", content: "boom", isError: true }];
    render(<AgentOutputPanel processes={[proc]} output="x" />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("renders an error block", () => {
    mockBlocks = [{ type: "error", content: "something failed" }];
    render(<AgentOutputPanel processes={[proc]} output="x" />);
    expect(screen.getByText("something failed")).toBeDefined();
  });

  it("renders a raw fallback block", () => {
    mockBlocks = [{ type: "raw", content: "unparsed line" }];
    render(<AgentOutputPanel processes={[proc]} output="x" />);
    expect(screen.getByText("unparsed line")).toBeDefined();
  });

  it("toggles between parsed and raw views", () => {
    mockBlocks = [{ type: "text", content: "parsed text" }];
    render(<AgentOutputPanel processes={[proc]} output="raw output text" />);
    expect(screen.getByText("parsed text")).toBeDefined();

    fireEvent.click(screen.getByText("raw"));
    expect(screen.getByText("raw output text")).toBeDefined();
    expect(screen.queryByText("parsed text")).toBeNull();

    fireEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("parsed text")).toBeDefined();
  });

  it("shows a waiting placeholder in raw mode when there is no output yet", () => {
    render(<AgentOutputPanel processes={[proc]} output="" />);
    fireEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("collapses and expands the panel on header click", () => {
    mockBlocks = [{ type: "text", content: "hello" }];
    render(<AgentOutputPanel processes={[proc]} output="x" />);
    expect(screen.getByText("hello")).toBeDefined();

    fireEvent.click(screen.getByText("claude-code"));
    expect(screen.queryByText("hello")).toBeNull();

    fireEvent.click(screen.getByText("claude-code"));
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("auto-expands when a process transitions from inactive to active", () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output="done" />);
    fireEvent.click(screen.getByText("Agent Output (completed)"));

    rerender(<AgentOutputPanel processes={[proc]} output="done" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });
});
