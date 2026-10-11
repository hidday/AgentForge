import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

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
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the 'completed' header when output exists but there is no active process", () => {
    render(<AgentOutputPanel processes={[]} output="hello output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders runtime, stage and elapsed timer when a process is active", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "codex", stage: "AIReview" })]}
        output=""
      />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("AIReview")).toBeDefined();
  });

  it("shows 'Waiting for output...' in the parsed view when there is no output", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("parses and renders text blocks from stream-json output", () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello from agent" },
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={line} />);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Parsed text" },
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={line} />);

    expect(screen.getByText("Parsed text")).toBeDefined();
    const toggle = screen.getByText("raw");
    await userEvent.click(toggle);

    expect(screen.getByText("parsed")).toBeDefined();
    expect(screen.getByText(line)).toBeDefined();
  });

  it("collapses and expands the panel when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="some output" />);

    expect(screen.getByText("raw")).toBeDefined();

    const header = screen.getByText("Implementing").closest("button")!;
    await userEvent.click(header);

    expect(screen.queryByText("raw")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("raw")).toBeDefined();
  });

  it("renders a tool_use block with the tool name, and expands/collapses its content", async () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={line} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();
  });

  it("renders a tool_result error block distinctly", () => {
    const line = JSON.stringify({ tool_use_result: "Error: something broke" });
    render(<AgentOutputPanel processes={[makeProcess()]} output={line} />);

    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Error: something broke")).toBeDefined();
  });

  it("re-expands the panel automatically when a process transitions from inactive to active", async () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output="prior output" />);

    const header = screen.getByText("Agent Output (completed)").closest("button")!;
    await userEvent.click(header);
    expect(screen.queryByText("raw")).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output="prior output" />);
    expect(screen.getByText("raw")).toBeDefined();
  });

  it("updates the elapsed timer display as time passes", () => {
    vi.useFakeTimers();
    try {
      const startedAt = new Date(Date.now() - 65_000).toISOString();
      render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);

      expect(screen.getByText("1m 5s")).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText("1m 6s")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
