import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

const { parseClaudeOutputMock } = vi.hoisted(() => ({
  parseClaudeOutputMock: vi.fn<(raw: string) => ParsedBlock[]>(),
}));

vi.mock("@/lib/parseClaudeOutput.ts", () => ({
  parseClaudeOutput: parseClaudeOutputMock,
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
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseClaudeOutputMock.mockReturnValue([]);
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

  it("renders the runtime/stage header and a live elapsed timer for an active process", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:10Z"));
    const proc = makeProcess({
      runtime: "claude-code",
      stage: "Implementing",
      startedAt: "2024-01-01T00:00:00Z",
    });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("10s")).toBeDefined();
  });

  it("formats the elapsed timer as minutes and seconds past 60s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:02:05Z"));
    const proc = makeProcess({ startedAt: "2024-01-01T00:00:00Z" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("2m 5s")).toBeDefined();
  });

  it("ticks the elapsed timer forward every second while mounted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const proc = makeProcess({ startedAt: "2024-01-01T00:00:00Z" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("0s")).toBeDefined();
    vi.advanceTimersByTime(3000);
    expect(screen.getByText("3s")).toBeDefined();
  });

  it("toggles collapsed state when the header button is clicked", async () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText(/raw/i)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /agent output/i }));
    expect(screen.queryByText(/raw/i)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /agent output/i }));
    expect(screen.getByText(/raw/i)).toBeDefined();
  });

  it("auto-expands (un-collapses) when a process transitions from inactive to active", async () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output="old output" />);
    await userEvent.click(screen.getByRole("button", { name: /agent output/i }));
    expect(screen.queryByText(/raw/i)).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output="old output" />);
    expect(await screen.findByText(/raw/i)).toBeDefined();
  });

  it("shows raw output text when the raw/parsed toggle is clicked", async () => {
    parseClaudeOutputMock.mockReturnValue([{ type: "text", content: "parsed text" }]);
    render(<AgentOutputPanel processes={[]} output="the raw ndjson" />);
    expect(screen.getByText("parsed text")).toBeDefined();

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("the raw ndjson")).toBeDefined();
    expect(screen.queryByText("parsed text")).toBeNull();
  });

  it("shows the 'Waiting for output...' placeholder in raw view when output is empty", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("shows the 'Waiting for output...' placeholder in parsed view when there are no blocks", () => {
    parseClaudeOutputMock.mockReturnValue([]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders a text block", () => {
    parseClaudeOutputMock.mockReturnValue([{ type: "text", content: "hello from the agent" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("hello from the agent")).toBeDefined();
  });

  it("renders a tool_use block with its tool name and expanded content by default, collapsing on click", async () => {
    parseClaudeOutputMock.mockReturnValue([
      { type: "tool_use", toolName: "Bash", content: "ls -la" },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();
  });

  it("renders a tool_use block with no content without crashing and without a content <pre>", () => {
    parseClaudeOutputMock.mockReturnValue([{ type: "tool_use", toolName: "Noop", content: "" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Noop")).toBeDefined();
  });

  it("renders a successful tool_result block without the error banner", () => {
    parseClaudeOutputMock.mockReturnValue([
      { type: "tool_result", content: "ok output", isError: false },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("ok output")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders a failed tool_result block with the error banner", () => {
    parseClaudeOutputMock.mockReturnValue([
      { type: "tool_result", content: "boom", isError: true },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
  });

  it("renders an error block", () => {
    parseClaudeOutputMock.mockReturnValue([{ type: "error", content: "something broke" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("something broke")).toBeDefined();
  });

  it("renders an unrecognized block type via the generic fallback renderer", () => {
    parseClaudeOutputMock.mockReturnValue([
      { type: "raw" as ParsedBlock["type"], content: "raw leftover line" },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("raw leftover line")).toBeDefined();
  });
});
