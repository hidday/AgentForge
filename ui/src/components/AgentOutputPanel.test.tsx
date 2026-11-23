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
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    elapsedMs: 1000,
    ...overrides,
  };
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
    expect(container.innerHTML).toBe("");
  });

  it("shows the completed label when output exists but no process is active", () => {
    render(<AgentOutputPanel processes={[]} output="some leftover output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows runtime, stage and elapsed timer for an active process", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "codex", stage: "AIReview" })]}
        output=""
      />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("AIReview")).toBeDefined();
  });

  it("toggles collapsed state when the header is clicked", async () => {
    render(
      <AgentOutputPanel processes={[makeProcess()]} output={JSON.stringify({
        content: [{ type: "text", text: "hello there" }],
      })} />,
    );
    expect(screen.getByText("hello there")).toBeDefined();

    await userEvent.click(screen.getByText("claude-code"));
    expect(screen.queryByText("hello there")).toBeNull();

    await userEvent.click(screen.getByText("claude-code"));
    expect(screen.getByText("hello there")).toBeDefined();
  });

  it("shows a waiting placeholder when parsing produces no blocks", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="   " />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders tool_use blocks and toggles their expansion", async () => {
    const raw = JSON.stringify({
      content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={raw} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();
  });

  it("renders tool_result error blocks with an Error label", () => {
    const raw = JSON.stringify({
      tool_use_result: "Error: file not found",
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={raw} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Error: file not found")).toBeDefined();
  });

  it("switches between parsed and raw views", async () => {
    const raw = JSON.stringify({ content: [{ type: "text", text: "parsed text block" }] });
    render(<AgentOutputPanel processes={[makeProcess()]} output={raw} />);

    expect(screen.getByText("parsed text block")).toBeDefined();
    await userEvent.click(screen.getByText("raw"));

    // Raw view renders the literal NDJSON string, not the parsed text
    expect(screen.queryByText("parsed text block")).toBeNull();
    expect(screen.getByText(raw)).toBeDefined();

    await userEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("parsed text block")).toBeDefined();
  });

  it("re-expands automatically when a new process becomes active after being collapsed", async () => {
    const { rerender } = render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByText("claude-code"));
    // collapsed: body content is gone
    expect(screen.queryByText("Waiting for output...")).toBeNull();

    // process completes; panel stays collapsed as-is
    rerender(<AgentOutputPanel processes={[]} output="done" />);
    expect(screen.queryByText("done")).toBeNull();

    // a new process starts again -- panel should auto re-expand
    rerender(<AgentOutputPanel processes={[makeProcess()]} output="done" />);
    expect(screen.getByText("done")).toBeDefined();
  });
});
