import { describe, it, expect, vi } from "vitest";
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
    elapsedMs: 0,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the completed label when output exists but there is no active process", () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders the active process runtime and stage when a process is active", () => {
    render(
      <AgentOutputPanel processes={[makeProcess({ runtime: "codex", stage: "Planning" })]} output="" />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("is expanded by default and shows the 'Waiting for output...' placeholder with no blocks", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("collapses and expands when the header is clicked", async () => {
    const user = userEvent.setup();
    render(<AgentOutputPanel processes={[makeProcess()]} output="hello" />);
    expect(screen.getByText("raw")).toBeDefined();

    const header = screen.getByText("Implementing").closest("button") as HTMLElement;
    await user.click(header);
    // Collapsed: the raw/parsed toggle (only visible when expanded) should disappear
    expect(screen.queryByText("raw")).toBeNull();

    await user.click(header);
    expect(screen.getByText("raw")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    const user = userEvent.setup();
    render(
      <AgentOutputPanel
        processes={[makeProcess()]}
        output={JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Hi there" } })}
      />,
    );
    expect(screen.getByText("Hi there")).toBeDefined();

    await user.click(screen.getByText("raw"));
    expect(screen.getByText("parsed")).toBeDefined();
    // Raw view shows the unparsed JSON text somewhere in a <pre>
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain("content_block_delta");
  });

  it("renders a tool_use block with an expandable tool name and input", () => {
    const toolUseLine = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={toolUseLine} />);
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("collapses a tool_use block's content when its header is clicked", async () => {
    const user = userEvent.setup();
    const toolUseLine = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={toolUseLine} />);
    const toggle = screen.getByText("Bash").closest("button") as HTMLElement;
    await user.click(toggle);
    expect(screen.queryByText("ls -la")).toBeNull();
  });

  it("renders a tool_result error block distinctly from a successful one", () => {
    const errorLine = JSON.stringify({ tool_use_result: "Error: file not found" });
    render(<AgentOutputPanel processes={[makeProcess()]} output={errorLine} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Error: file not found")).toBeDefined();
  });

  it("renders a successful tool_result without the Error label", () => {
    const okLine = JSON.stringify({ tool_use_result: "All good" });
    render(<AgentOutputPanel processes={[makeProcess()]} output={okLine} />);
    expect(screen.getByText("All good")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders raw non-JSON lines as raw blocks", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="plain line of text" />);
    expect(screen.getByText("plain line of text")).toBeDefined();
  });

  it("shows the elapsed timer in seconds for a recently started process", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ startedAt: new Date().toISOString() })]}
        output=""
      />,
    );
    expect(screen.getByText(/^\d+s$/)).toBeDefined();
  });

  it("shows the elapsed timer in minutes and seconds once a minute has passed", () => {
    vi.useFakeTimers();
    try {
      const startedAt = new Date(Date.now() - 65_000).toISOString();
      render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
      vi.advanceTimersByTime(1_000);
      expect(screen.getByText(/^1m \d+s$/)).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
