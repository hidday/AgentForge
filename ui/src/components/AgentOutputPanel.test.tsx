import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

const process1: ActiveProcess = {
  id: "proc-1",
  pid: 1234,
  command: "claude",
  runId: "run-1",
  stage: "Implementing",
  runtime: "claude-code",
  startedAt: "2026-09-08T00:00:00.000Z",
  elapsedMs: 0,
};

function textDelta(text: string) {
  return JSON.stringify({
    type: "content_block_delta",
    delta: { type: "text_delta", text },
  });
}

function toolUseStart(name: string, input: Record<string, unknown>) {
  return JSON.stringify({
    type: "content_block_start",
    content_block: { type: "tool_use", name, input },
  });
}

function toolResult(content: string, isError = false) {
  return JSON.stringify({ tool_use_result: isError ? `Error: ${content}` : content });
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

  it("renders the completed header when output exists but no active process", () => {
    render(<AgentOutputPanel processes={[]} output={textDelta("hello")} />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders the active process header with runtime, stage, and elapsed timer", () => {
    render(<AgentOutputPanel processes={[process1]} output="" />);
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("updates the elapsed timer as time passes, formatting minutes when over 60s", () => {
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    render(
      <AgentOutputPanel
        processes={[{ ...process1, startedAt }]}
        output=""
      />,
    );
    expect(screen.getByText(/^\d+s$/)).toBeDefined();

    act(() => {
      vi.setSystemTime(new Date(Date.now() + 65_000));
      vi.advanceTimersByTime(65_000);
    });

    expect(screen.getByText(/^\d+m \d+s$/)).toBeDefined();
  });

  it("toggles collapsed state when the header is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AgentOutputPanel processes={[]} output={textDelta("hello")} />);

    // Expanded by default — body content visible
    expect(screen.getByText("hello")).toBeDefined();

    const header = screen.getByText("Agent Output (completed)").closest("button")!;
    await user.click(header);
    expect(screen.queryByText("hello")).toBeNull();

    await user.click(header);
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("auto-expands when a process transitions from inactive to active", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(
      <AgentOutputPanel processes={[]} output={textDelta("hello")} />,
    );
    const header = screen.getByText("Agent Output (completed)").closest("button")!;
    await user.click(header);
    expect(screen.queryByText("hello")).toBeNull();

    rerender(<AgentOutputPanel processes={[process1]} output={textDelta("hello")} />);

    expect(await screen.findByText("hello")).toBeDefined();
  });

  it("shows the waiting placeholder in parsed view when there is no parseable content", () => {
    render(<AgentOutputPanel processes={[process1]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders text blocks", () => {
    render(<AgentOutputPanel processes={[]} output={textDelta("Hello from agent")} />);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("renders tool_use blocks expanded by default with tool name and input, and collapses on click", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AgentOutputPanel processes={[]} output={toolUseStart("Bash", { command: "ls -la" })} />,
    );
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await user.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await user.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a successful tool_result block without the error indicator", () => {
    render(<AgentOutputPanel processes={[]} output={toolResult("build succeeded")} />);
    expect(screen.getByText("build succeeded")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders an errored tool_result block with the error indicator", () => {
    render(<AgentOutputPanel processes={[]} output={toolResult("build failed", true)} />);
    expect(screen.getByText("Error: build failed")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
  });

  it("renders raw/unparsed non-JSON lines using the default renderer", () => {
    render(<AgentOutputPanel processes={[]} output="plain unstructured log line here" />);
    expect(screen.getByText("plain unstructured log line here")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const output = textDelta("Hello from agent");
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Hello from agent")).toBeDefined();

    const toggleBtn = screen.getByText("raw");
    await user.click(toggleBtn);

    expect(screen.getByText("parsed")).toBeDefined();
    expect(screen.getByText(output)).toBeDefined();

    await user.click(screen.getByText("parsed"));
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("shows the 'Waiting for output...' placeholder in raw view when output is empty", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AgentOutputPanel processes={[process1]} output="" />);
    await user.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });
});
