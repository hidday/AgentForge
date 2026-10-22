import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

function makeProcess(partial: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "claude",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    ...partial,
  };
}

describe("AgentOutputPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the completed label when output is present but no process is active", () => {
    // output alone (no process) keeps the panel mounted even though it's "completed"
    render(<AgentOutputPanel processes={[]} output="some text" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the runtime, stage, and a live indicator when a process is active", () => {
    const proc = makeProcess({ runtime: "codex", stage: "AIReview" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("AIReview")).toBeDefined();
  });

  it("toggles collapsed state when the header is clicked", async () => {
    const proc = makeProcess();
    render(<AgentOutputPanel processes={[proc]} output="hello" />);
    expect(screen.getByText("raw")).toBeDefined();

    const header = screen.getAllByRole("button")[0];
    await userEvent.click(header);
    // After collapsing, the raw/parsed toggle button should no longer be present
    expect(screen.queryByText("raw")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("raw")).toBeDefined();
  });

  it("renders parsed text blocks by default", () => {
    const output = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello from the agent" },
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("shows 'Waiting for output...' when there are no parsed blocks yet", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("switches to raw view and shows the unparsed output text", async () => {
    const output = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Parsed text" },
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText(output)).toBeDefined();
    expect(screen.getByText("parsed")).toBeDefined();
  });

  it("renders a tool_use block with its tool name and expandable input, toggling on click", async () => {
    const output = JSON.stringify([
      { type: "tool_use", name: "Read", input: { file_path: "/tmp/a.ts" } },
    ]);
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("/tmp/a.ts")).toBeDefined();

    await userEvent.click(screen.getByText("Read"));
    expect(screen.queryByText("/tmp/a.ts")).toBeNull();
  });

  it("renders a tool_result error block with the error styling and label", () => {
    const output = JSON.stringify([
      { type: "tool_result", content: "boom", is_error: true },
    ]);
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("renders a raw-fallback block for an unparseable, non-noise line", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="plain unstructured line" />);
    expect(screen.getByText("plain unstructured line")).toBeDefined();
  });

  it("updates the elapsed timer display over time for an active process", () => {
    vi.useFakeTimers();
    const startedAt = new Date().toISOString();
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText("0s")).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText("1m 5s")).toBeDefined();
  });
});
