import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
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

const TEXT_LINE = JSON.stringify({
  type: "content_block_delta",
  delta: { type: "text_delta", text: "Hello world" },
});
const TOOL_USE_LINE = JSON.stringify({
  type: "content_block_start",
  content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
});
const TOOL_RESULT_OK_LINE = JSON.stringify({
  tool_use_result: { stdout: "file1\nfile2", stderr: "" },
});
const TOOL_RESULT_ERR_LINE = JSON.stringify({
  tool_use_result: "Error: something failed",
});
const RAW_NOISE_FREE_LINE = "a totally plain non-json line of output";

const FULL_OUTPUT = [
  TEXT_LINE,
  TOOL_USE_LINE,
  TOOL_RESULT_OK_LINE,
  TOOL_RESULT_ERR_LINE,
  RAW_NOISE_FREE_LINE,
].join("\n");

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentOutputPanel", () => {
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the completed label when output exists but there is no active process", () => {
    render(<AgentOutputPanel processes={[]} output={FULL_OUTPUT} />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the active process runtime, stage and a live elapsed timer", () => {
    vi.useFakeTimers();
    const startedAt = new Date(Date.now() - 65_000).toISOString();
    render(
      <AgentOutputPanel
        processes={[makeProcess({ startedAt })]}
        output=""
      />,
    );
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("1m 5s")).toBeDefined();
  });

  it("updates the elapsed timer as time passes", () => {
    vi.useFakeTimers();
    const startedAt = new Date().toISOString();
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText("0s")).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText("3s")).toBeDefined();
  });

  it("parses and renders text, tool_use, and tool_result blocks", () => {
    render(<AgentOutputPanel processes={[]} output={FULL_OUTPUT} />);
    expect(screen.getByText("Hello world")).toBeDefined();
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText(/file1/)).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText(/something failed/)).toBeDefined();
  });

  it("shows a waiting message when there is no output yet but a process is active", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("collapses and re-expands the panel body when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[]} output={FULL_OUTPUT} />);
    expect(screen.getByText("Hello world")).toBeDefined();

    const header = screen.getByText("Agent Output (completed)").closest("button")!;
    await userEvent.click(header);
    expect(screen.queryByText("Hello world")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("toggles between parsed and raw view", async () => {
    render(<AgentOutputPanel processes={[]} output={FULL_OUTPUT} />);
    expect(screen.getByText("Bash")).toBeDefined();

    const toggle = screen.getByText("raw");
    await userEvent.click(toggle);

    expect(screen.getByText("parsed")).toBeDefined();
    expect(screen.queryByText("Bash")).toBeNull();
    // Raw view shows the full raw output text in a <pre>.
    expect(screen.getByText(RAW_NOISE_FREE_LINE, { exact: false })).toBeDefined();
  });

  it("shows the raw placeholder text when output is empty in raw view", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    const toggle = screen.getByText("raw");
    await userEvent.click(toggle);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("collapses the tool_use block content when its header is clicked", async () => {
    render(<AgentOutputPanel processes={[]} output={TOOL_USE_LINE} />);
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("re-expands automatically when a process transitions from inactive to active", async () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output={FULL_OUTPUT} />);

    const header = screen.getByText("Agent Output (completed)").closest("button")!;
    await userEvent.click(header);
    expect(screen.queryByText("Hello world")).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output={FULL_OUTPUT} />);

    expect(await screen.findByText("Hello world")).toBeDefined();
  });
});
