import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

function makeProcess(overrides: Partial<ActiveProcess>): ActiveProcess {
  return {
    id: "proc-1",
    pid: 123,
    command: "claude",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2024-01-01T00:00:05Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the runtime, stage, and a running elapsed timer when a process is active", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "claude-code", stage: "Implementing" })]}
        output=""
      />,
    );
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    // 5 seconds elapsed from startedAt to the mocked "now"
    expect(screen.getByText("5s")).toBeDefined();
  });

  it("formats the elapsed timer in minutes and seconds once more than a minute has passed", () => {
    vi.setSystemTime(new Date("2024-01-01T00:01:30Z"));
    render(
      <AgentOutputPanel
        processes={[makeProcess({ startedAt: "2024-01-01T00:00:00Z" })]}
        output=""
      />,
    );
    expect(screen.getByText("1m 30s")).toBeDefined();
  });

  it("shows 'Agent Output (completed)' label when output exists but no process is active", () => {
    render(<AgentOutputPanel processes={[]} output="some output text" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("parses and renders a text block from JSON stream output", () => {
    const line = JSON.stringify({
      type: "assistant",
      content: [{ type: "text", text: "Hello from the agent" }],
    });
    render(<AgentOutputPanel processes={[]} output={line} />);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("renders a tool_use block with the tool name and expand/collapse toggle", async () => {
    const line = JSON.stringify({
      type: "assistant",
      content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
    });
    render(<AgentOutputPanel processes={[]} output={line} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    // Toggle collapsed
    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    // Toggle back open
    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a tool_result error block with an Error label", () => {
    const line = JSON.stringify({
      type: "user",
      content: [{ type: "tool_result", content: "boom", is_error: true }],
    });
    render(<AgentOutputPanel processes={[]} output={line} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("shows a waiting placeholder when output produces no parsed blocks but a process is active", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({})]}
        output=""
      />,
    );
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles between parsed and raw view", async () => {
    const line = JSON.stringify({
      type: "assistant",
      content: [{ type: "text", text: "Parsed text block" }],
    });
    render(<AgentOutputPanel processes={[]} output={line} />);

    expect(screen.getByText("Parsed text block")).toBeDefined();

    await userEvent.click(screen.getByText("raw"));
    // Raw view shows the exact raw NDJSON line
    expect(screen.getByText(line)).toBeDefined();
    expect(screen.queryByText("Parsed text block")).toBeNull();

    await userEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("Parsed text block")).toBeDefined();
  });

  it("collapses and expands the whole panel when the header is clicked", async () => {
    const line = JSON.stringify({
      type: "assistant",
      content: [{ type: "text", text: "Visible text" }],
    });
    render(<AgentOutputPanel processes={[]} output={line} />);

    expect(screen.getByText("Visible text")).toBeDefined();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("Visible text")).toBeNull();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.getByText("Visible text")).toBeDefined();
  });
});
