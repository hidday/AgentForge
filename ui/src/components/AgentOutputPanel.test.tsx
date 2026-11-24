import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "pnpm test",
    runId: "r1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
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
    expect(container.firstChild).toBeNull();
  });

  it("shows 'Agent Output (completed)' when there is output but no active process", () => {
    render(<AgentOutputPanel processes={[]} output="some log line" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the runtime, stage, and an elapsed timer for an active process", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("ticks the elapsed timer forward as time passes", () => {
    const startedAt = new Date().toISOString();
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText("0s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText("1m 5s")).toBeDefined();
  });

  it("toggles collapsed state when the header is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AgentOutputPanel processes={[makeProcess()]} output="some text" />);

    expect(screen.getByText(/raw/)).toBeDefined();
    await user.click(screen.getByText("claude-code").closest("button")!);
    expect(screen.queryByText(/^raw$/)).toBeNull();
  });

  it("shows 'Waiting for output...' in parsed view when output produced no blocks", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders parsed text blocks from JSON output", () => {
    const output = JSON.stringify({ content: [{ type: "text", text: "Hello from agent" }] });
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("renders a tool_use block and toggles its expanded input on click", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const output = JSON.stringify({
      content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await user.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();
  });

  it("renders an errored tool_result block with the error styling", () => {
    const output = JSON.stringify({ tool_use_result: "Error: command not found" });
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText(/command not found/)).toBeDefined();
  });

  it("switches to the raw output view when the toggle is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const output = JSON.stringify({ content: [{ type: "text", text: "Hello" }] });
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);

    await user.click(screen.getByText("raw"));
    expect(screen.getByText(output)).toBeDefined();
    expect(screen.getByText("parsed")).toBeDefined();
  });

  it("shows the placeholder text in raw view when output is empty", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await user.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });
});
