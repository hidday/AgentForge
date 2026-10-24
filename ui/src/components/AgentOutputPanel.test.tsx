import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "claude",
    runId: "r1",
    stage: "implement",
    runtime: "claude",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

const TEXT_LINE = JSON.stringify({ content: [{ type: "text", text: "Hello agent" }] });
const TOOL_USE_LINE = JSON.stringify({
  content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
});
const TOOL_RESULT_OK_LINE = JSON.stringify({
  content: [{ type: "tool_result", content: "file1\nfile2", is_error: false }],
});
const TOOL_RESULT_ERR_LINE = JSON.stringify({
  content: [{ type: "tool_result", content: "boom", is_error: true }],
});

describe("AgentOutputPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the completed label when output exists but no process is active", () => {
    render(<AgentOutputPanel processes={[]} output={TEXT_LINE} />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the active process runtime, stage, and an elapsed timer", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("claude")).toBeDefined();
    expect(screen.getByText("implement")).toBeDefined();
  });

  it("formats elapsed time with minutes once past 60 seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:01:05Z"));
    render(
      <AgentOutputPanel
        processes={[makeProcess({ startedAt: "2024-01-01T00:00:00Z" })]}
        output=""
      />,
    );
    expect(screen.getByText("1m 5s")).toBeDefined();
  });

  it("shows seconds-only elapsed time under a minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    render(
      <AgentOutputPanel
        processes={[makeProcess({ startedAt: "2024-01-01T00:00:00Z" })]}
        output=""
      />,
    );
    expect(screen.getByText("30s")).toBeDefined();
  });

  it("collapses and expands the body when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[]} output={TEXT_LINE} />);
    expect(screen.getByText("Hello agent")).toBeDefined();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("Hello agent")).toBeNull();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.getByText("Hello agent")).toBeDefined();
  });

  it("renders parsed text, tool_use, and tool_result blocks", () => {
    const output = [TEXT_LINE, TOOL_USE_LINE, TOOL_RESULT_OK_LINE, TOOL_RESULT_ERR_LINE].join(
      "\n",
    );
    const { container } = render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Hello agent")).toBeDefined();
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();
    expect(container.textContent).toContain("file1");
    expect(container.textContent).toContain("file2");
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
  });

  it("toggles a tool_use block's expanded input on click", async () => {
    render(<AgentOutputPanel processes={[]} output={TOOL_USE_LINE} />);
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a non-JSON, non-noise output line as a raw block", () => {
    render(<AgentOutputPanel processes={[]} output="plain unparsed output line" />);
    expect(screen.getByText("plain unparsed output line")).toBeDefined();
  });

  it("shows a 'Waiting for output...' placeholder when there are no parsed blocks yet", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    render(<AgentOutputPanel processes={[]} output={TEXT_LINE} />);

    expect(screen.getByText("Hello agent")).toBeDefined();
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText(TEXT_LINE)).toBeDefined();
    expect(screen.queryByText("Hello agent")).toBeNull();

    await userEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("Hello agent")).toBeDefined();
  });

  it("re-expands automatically when a new process becomes active after being collapsed", async () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output={TEXT_LINE} />);

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("Hello agent")).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output={TEXT_LINE} />);
    expect(screen.getByText("Hello agent")).toBeDefined();
  });
});
