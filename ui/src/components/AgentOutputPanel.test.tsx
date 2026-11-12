import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 1234,
    command: "claude",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: "2024-01-01T00:00:00.000Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2024-01-01T00:00:05.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the completed header when output exists but there is no active process", () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders the active process header with runtime, stage and elapsed timer", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "codex", stage: "Planning" })]}
        output=""
      />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
    // 5 seconds elapsed from fake time setup
    expect(screen.getByText("5s")).toBeDefined();
  });

  it("formats elapsed time in minutes and seconds once over a minute", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ startedAt: "2024-01-01T00:00:00.000Z" })]}
        output=""
      />,
    );
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText("1m 10s")).toBeDefined();
  });

  it("shows the waiting placeholder when output is empty but a process is active", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getAllByText("Waiting for output...").length).toBeGreaterThan(0);
  });

  it("is expanded by default and can be collapsed via the header button", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="Hello" />);
    expect(screen.getByText("Hello")).toBeDefined();

    const headerBtn = screen.getByRole("button", { name: /codex|claude-code/i });
    await userEvent.click(headerBtn);

    expect(screen.queryByText("Hello")).toBeNull();
  });

  it("re-expands automatically when a process transitions from inactive to active", () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output="done output" />);

    // Collapse it first via clicking the header button.
    const headerBtn = screen.getByRole("button", { name: /Agent Output/i });
    act(() => {
      headerBtn.click();
    });
    expect(screen.queryByText("done output")).toBeNull();

    // Now a new process becomes active -- panel should auto re-expand.
    act(() => {
      rerender(<AgentOutputPanel processes={[makeProcess()]} output="new output" />);
    });

    expect(screen.getByText("new output")).toBeDefined();
  });

  it("renders parsed text blocks from NDJSON content-array output", () => {
    const line = JSON.stringify({
      content: [{ type: "text", text: "Hello from agent" }],
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={line} />);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("renders a tool_use block with the tool name and expandable input, togglable", async () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={line} />);
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    // Toggle collapse of the tool_use block
    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();
  });

  it("renders a tool_result error block with the Error label and red styling", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: "boom", is_error: true }],
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={line} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("renders a tool_result success block without the Error label", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: "ok result", is_error: false }],
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={line} />);
    expect(screen.queryByText("Error")).toBeNull();
    expect(screen.getByText("ok result")).toBeDefined();
  });

  it("toggles between parsed and raw view using the raw/parsed button", async () => {
    const line = JSON.stringify({
      content: [{ type: "text", text: "Parsed text" }],
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={line} />);

    expect(screen.getByText("Parsed text")).toBeDefined();

    const rawToggle = screen.getByText("raw");
    await userEvent.click(rawToggle);

    // In raw mode the original NDJSON line is shown verbatim
    expect(screen.getByText(line)).toBeDefined();
    expect(screen.getByText("parsed")).toBeDefined();
  });

  it("shows the waiting placeholder in raw mode when output is empty", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });
});
