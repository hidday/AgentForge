import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  it("renders the completed label when output exists but there is no active process", async () => {
    vi.useRealTimers();
    render(<AgentOutputPanel processes={[]} output="some raw output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the active process runtime, stage, and elapsed timer", async () => {
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const proc = makeProcess({ startedAt: "2024-01-01T00:00:00Z", runtime: "claude-code", stage: "Implementing" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("updates the elapsed timer every second while active", () => {
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const proc = makeProcess({ startedAt: "2024-01-01T00:00:00Z" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("0s")).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("5s")).toBeDefined();
  });

  it("formats elapsed time in minutes and seconds past 60s", () => {
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const proc = makeProcess({ startedAt: "2024-01-01T00:00:00Z" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    act(() => {
      vi.advanceTimersByTime(75_000);
    });
    expect(screen.getByText("1m 15s")).toBeDefined();
  });

  it("toggles collapsed state when the header is clicked", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    render(<AgentOutputPanel processes={[]} output="raw output text" />);
    expect(screen.getByText("raw output text")).toBeDefined();
    const header = screen.getByRole("button", { name: /Agent Output \(completed\)/i });
    await user.click(header);
    expect(screen.queryByText("raw output text")).toBeNull();
    await user.click(header);
    expect(screen.getByText("raw output text")).toBeDefined();
  });

  it("auto-expands when a process transitions from inactive to active", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const { rerender } = render(<AgentOutputPanel processes={[]} output="old output" />);
    const header = screen.getByRole("button", { name: /Agent Output \(completed\)/i });
    await user.click(header);
    expect(screen.queryByText(/old output|Waiting for output/)).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output="old output" />);
    expect(await screen.findByText(/parsed|raw/i)).toBeDefined();
  });

  it("shows 'Waiting for output...' in parsed view when there are no blocks", () => {
    vi.useRealTimers();
    render(<AgentOutputPanel processes={[]} output="   " />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const output = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Read", input: { file_path: "/a.ts" } },
    });
    render(<AgentOutputPanel processes={[]} output={output} />);

    // Parsed view shows the tool name
    expect(screen.getByText("Read")).toBeDefined();

    const toggleBtn = screen.getByRole("button", { name: /raw/i });
    await user.click(toggleBtn);

    // Raw view shows the raw JSON text instead
    expect(screen.getByText(output)).toBeDefined();
    expect(screen.getByRole("button", { name: /parsed/i })).toBeDefined();
  });

  it("renders a text block", () => {
    vi.useRealTimers();
    const output = JSON.stringify([{ type: "text", text: "Hello from the agent" }]);
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("renders a tool_use block and toggles its expanded details", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const output = JSON.stringify([
      { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
    ]);
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    const toolToggle = screen.getByRole("button", { name: /Bash/i });
    await user.click(toolToggle);
    expect(screen.queryByText("ls -la")).toBeNull();

    await user.click(toolToggle);
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a tool_result block with error styling when isError", () => {
    vi.useRealTimers();
    const output = JSON.stringify([
      { type: "tool_result", content: "boom", is_error: true },
    ]);
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("renders a tool_result block without error styling when not an error", () => {
    vi.useRealTimers();
    const output = JSON.stringify([
      { type: "tool_result", content: "all good", is_error: false },
    ]);
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.queryByText("Error")).toBeNull();
    expect(screen.getByText("all good")).toBeDefined();
  });

  it("renders a raw fallback block for unparseable non-noise lines", () => {
    vi.useRealTimers();
    render(<AgentOutputPanel processes={[]} output="this is not json at all" />);
    expect(screen.getByText("this is not json at all")).toBeDefined();
  });
});

describe("AgentOutputPanel error block rendering", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("renders an 'error' block type with the AlertTriangle icon and red styling", async () => {
    vi.resetModules();
    vi.doMock("@/lib/parseClaudeOutput.ts", () => ({
      parseClaudeOutput: () => [{ type: "error", content: "Something broke" }],
    }));
    const { AgentOutputPanel: PanelWithMockedParser } = await import("./AgentOutputPanel.tsx");
    render(<PanelWithMockedParser processes={[]} output="irrelevant" />);
    expect(screen.getByText("Something broke")).toBeDefined();
    vi.doUnmock("@/lib/parseClaudeOutput.ts");
    vi.resetModules();
  });
});
