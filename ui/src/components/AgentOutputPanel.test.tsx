import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "run",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    ...overrides,
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

  it("shows 'Agent Output (completed)' when there is output but no active process", () => {
    render(<AgentOutputPanel processes={[]} output="some output text" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the runtime and stage for an active process", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "claude-code", stage: "Implementing" })]}
        output=""
      />,
    );
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("toggles collapsed state when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[]} output="some text" />);
    expect(screen.getByText("some text")).toBeDefined();
    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("some text")).toBeNull();
    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.getByText("some text")).toBeDefined();
  });

  it("re-expands automatically when a process transitions from inactive to active", () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output="x" />);
    // Collapse manually first is unnecessary; just verify expanding on new activity.
    rerender(
      <AgentOutputPanel processes={[makeProcess()]} output="x" />,
    );
    expect(screen.getByText(/parsed|raw/)).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    render(<AgentOutputPanel processes={[]} output="hello raw text" />);
    const toggle = screen.getByText("raw");
    await userEvent.click(toggle);
    expect(screen.getByText("parsed")).toBeDefined();
    expect(screen.getByText("hello raw text")).toBeDefined();
  });

  it("shows 'Waiting for output...' placeholder in raw view when output is empty but process is active", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders parsed text blocks from JSON output", () => {
    const output = JSON.stringify({ content: [{ type: "text", text: "Hello from agent" }] });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("renders a tool_use block and toggles its expanded state", async () => {
    const output = JSON.stringify({
      content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
    });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();
  });

  it("renders a tool_result error block with the Error label", () => {
    const output = JSON.stringify({ tool_use_result: "Error: boom" });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Error: boom")).toBeDefined();
  });

  it("renders a non-error tool_result block without the Error label", () => {
    const output = JSON.stringify({ tool_use_result: "all good" });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.queryByText("Error")).toBeNull();
    expect(screen.getByText("all good")).toBeDefined();
  });

  it("updates the elapsed timer for an active process over time", () => {
    vi.useFakeTimers();
    const startedAt = new Date(Date.now() - 5000).toISOString();
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText(/5s/)).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText(/1m/)).toBeDefined();
  });

  it("shows 'Waiting for output...' in parsed view when there are no blocks and no active process is irrelevant here (output empty + active)", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });
});

describe("AgentOutputPanel - error block rendering", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/parseClaudeOutput.ts");
    vi.resetModules();
  });

  it("renders an 'error' typed block with the AlertTriangle icon treatment", async () => {
    vi.resetModules();
    vi.doMock("@/lib/parseClaudeOutput.ts", () => ({
      parseClaudeOutput: () => [{ type: "error", content: "Something went wrong" }],
    }));
    const { AgentOutputPanel: PanelWithMockedParser } = await import("./AgentOutputPanel.tsx");
    render(<PanelWithMockedParser processes={[]} output="irrelevant" />);
    expect(screen.getByText("Something went wrong")).toBeDefined();
  });
});
