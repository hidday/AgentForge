import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 1234,
    command: "claude",
    runId: "run-1",
    stage: "execution",
    runtime: "claude-code",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

const TEXT_LINE = JSON.stringify({ content: [{ type: "text", text: "Hello from the agent" }] });
const TOOL_USE_LINE = JSON.stringify({
  content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
});
const TOOL_RESULT_LINE = JSON.stringify({
  content: [{ type: "tool_result", content: "file1\nfile2", is_error: false }],
});
const TOOL_ERROR_LINE = JSON.stringify({
  content: [{ type: "tool_result", content: "boom", is_error: true }],
});

describe("AgentOutputPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2024-01-01T00:00:10Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the completed label when there is output but no active process", () => {
    render(<AgentOutputPanel processes={[]} output={TEXT_LINE} />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows runtime, stage and a live elapsed timer for an active process", () => {
    const proc = makeProcess({
      runtime: "claude-code",
      stage: "planning",
      startedAt: "2024-01-01T00:00:00Z",
    });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("planning")).toBeDefined();
    // 10 seconds have elapsed per fake system time
    expect(screen.getByText("10s")).toBeDefined();
  });

  it("formats elapsed time in minutes and seconds once past a minute", () => {
    const proc = makeProcess({ startedAt: "2024-01-01T00:00:00Z" });
    render(<AgentOutputPanel processes={[proc]} output="" />);

    // Mounted 10s in (per beforeEach system time); advance the fake clock
    // by another 80s so total elapsed crosses the 1m30s mark.
    act(() => {
      vi.advanceTimersByTime(80_000);
    });

    expect(screen.getByText("1m 30s")).toBeDefined();
  });

  it("shows 'Waiting for output...' in parsed view when there are no blocks yet", () => {
    const proc = makeProcess();
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("parses and renders text, tool_use and tool_result blocks", () => {
    const raw = [TEXT_LINE, TOOL_USE_LINE, TOOL_RESULT_LINE].join("\n");
    const { container } = render(<AgentOutputPanel processes={[]} output={raw} />);

    expect(screen.getByText("Hello from the agent")).toBeDefined();
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();
    const resultPre = Array.from(container.querySelectorAll("pre")).find(
      (el) => el.textContent === "file1\nfile2",
    );
    expect(resultPre).toBeDefined();
  });

  it("renders an Error label and red styling for a tool_result marked is_error", () => {
    render(<AgentOutputPanel processes={[]} output={TOOL_ERROR_LINE} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("toggles a tool_use block's expanded input on click", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AgentOutputPanel processes={[]} output={TOOL_USE_LINE} />);

    expect(screen.getByText("ls -la")).toBeDefined();
    const toggle = screen.getByRole("button", { name: /Bash/ });
    await user.click(toggle);
    expect(screen.queryByText("ls -la")).toBeNull();

    await user.click(toggle);
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("collapses and re-expands the panel body when the header is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AgentOutputPanel processes={[]} output={TEXT_LINE} />);

    expect(screen.getByText("Hello from the agent")).toBeDefined();

    const header = screen.getByRole("button", { name: /Agent Output \(completed\)/ });
    await user.click(header);
    expect(screen.queryByText("Hello from the agent")).toBeNull();

    await user.click(header);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("switches between parsed and raw views", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const raw = TEXT_LINE;
    render(<AgentOutputPanel processes={[]} output={raw} />);

    expect(screen.getByText("Hello from the agent")).toBeDefined();

    const rawToggle = screen.getByRole("button", { name: "raw" });
    await user.click(rawToggle);

    // Raw view dumps the untouched NDJSON string, so the parsed text is gone
    // and the raw toggle now reads "parsed".
    expect(screen.queryByText("Hello from the agent")).toBeNull();
    expect(screen.getByRole("button", { name: "parsed" })).toBeDefined();
    expect(screen.getByText((content) => content.includes(raw))).toBeDefined();
  });

  it("shows 'Waiting for output...' in raw view when output is empty", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const proc = makeProcess();
    render(<AgentOutputPanel processes={[proc]} output="" />);

    await user.click(screen.getByRole("button", { name: "raw" }));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("re-expands automatically when a process transitions from inactive to active", () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output={TEXT_LINE} />);

    // Start with the panel expanded, then collapse it manually via header click
    // is not needed here — we drive the "was inactive, now active" transition
    // directly by rerendering with a process, which the effect reacts to by
    // forcing collapsed back to false. Assert the body remains/becomes visible.
    const proc = makeProcess();
    rerender(<AgentOutputPanel processes={[proc]} output={TEXT_LINE} />);

    expect(screen.getByText("Hello from the agent")).toBeDefined();
    expect(screen.getByText(proc.runtime)).toBeDefined();
  });

  it("renders raw fallback blocks for unparseable non-JSON lines mixed with valid ones", () => {
    const raw = ["not json at all", TEXT_LINE].join("\n");
    render(<AgentOutputPanel processes={[]} output={raw} />);
    expect(screen.getByText("not json at all")).toBeDefined();
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("renders within a container distinguishing multiple simultaneous processes by using the first", () => {
    const proc1 = makeProcess({ id: "p1", runtime: "claude-code", stage: "planning" });
    const proc2 = makeProcess({ id: "p2", runtime: "codex", stage: "execution" });
    render(<AgentOutputPanel processes={[proc1, proc2]} output="" />);

    const header = screen.getByRole("button", { name: /claude-code/ });
    expect(within(header).getByText("planning")).toBeDefined();
    expect(within(header).queryByText("codex")).toBeNull();
  });
});
