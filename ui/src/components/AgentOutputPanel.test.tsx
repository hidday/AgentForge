import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "claude",
    runId: "run-1",
    stage: "executor",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    ...overrides,
  } as ActiveProcess;
}

describe("AgentOutputPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the completed label when output exists but there is no active process", () => {
    render(<AgentOutputPanel processes={[]} output="hello" />);
    expect(screen.getByText("Agent Output (completed)")).toBeInTheDocument();
  });

  it("shows the running process's runtime, stage, and an elapsed timer when active", () => {
    const proc = makeProcess({ runtime: "codex", stage: "reviewer" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.getByText("reviewer")).toBeInTheDocument();
    expect(screen.getByText(/^\d+s$/)).toBeInTheDocument();
  });

  it("formats elapsed time in minutes and seconds once over a minute has passed", () => {
    const startedAt = new Date(Date.now() - 65_000).toISOString();
    const proc = makeProcess({ startedAt });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText(/^1m \d+s$/)).toBeInTheDocument();
  });

  it("toggles collapsed state when the header is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AgentOutputPanel processes={[]} output="some output text" />);
    const header = screen.getByText("Agent Output (completed)");
    // panel starts expanded: raw/parsed toggle visible
    expect(screen.getByText("raw")).toBeInTheDocument();
    await user.click(header);
    expect(screen.queryByText("raw")).not.toBeInTheDocument();
    await user.click(header);
    expect(screen.getByText("raw")).toBeInTheDocument();
  });

  it("shows waiting placeholder in parsed mode when an active process has produced no output yet", () => {
    const proc = makeProcess();
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeInTheDocument();
  });

  it("renders parsed text, tool_use, tool_result, and error blocks from stream-json output", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const lines = [
      JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Thinking..." } }),
      JSON.stringify({
        type: "content_block_start",
        content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
      }),
      JSON.stringify({ tool_use_result: "total 0\ndone" }),
      JSON.stringify({
        content: [{ type: "text", text: "An error occurred" }],
      }),
    ].join("\n");

    render(<AgentOutputPanel processes={[]} output={lines} />);

    expect(screen.getByText("Thinking...")).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();

    // tool_use block starts expanded; its content should be visible
    expect(screen.getByText("ls -la")).toBeInTheDocument();

    // Collapse the tool_use block
    await user.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).not.toBeInTheDocument();
  });

  it("renders raw output verbatim when the raw toggle is active", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const raw = JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } });
    render(<AgentOutputPanel processes={[]} output={raw} />);

    await user.click(screen.getByText("raw"));
    expect(screen.getByText("parsed")).toBeInTheDocument();
    expect(screen.getByText(raw)).toBeInTheDocument();
  });

  it("marks tool_result blocks as errors with the Error label when isError is true", () => {
    const lines = [JSON.stringify({ tool_use_result: "Error: boom" })].join("\n");
    render(<AgentOutputPanel processes={[]} output={lines} />);
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("boom", { exact: false })).toBeInTheDocument();
  });

  it("re-expands the panel automatically when a process transitions from inactive to active", async () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output="done output" />);
    const header = screen.getByText("Agent Output (completed)");
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(header);
    expect(screen.queryByText("raw")).not.toBeInTheDocument();

    const proc = makeProcess();
    rerender(<AgentOutputPanel processes={[proc]} output="done output" />);
    expect(screen.getByText("raw")).toBeInTheDocument();
  });
});
