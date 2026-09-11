import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
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

const textLine = JSON.stringify({
  type: "content_block_delta",
  delta: { type: "text_delta", text: "Hello from the agent" },
});

const toolUseLine = JSON.stringify({
  type: "content_block_start",
  content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
});

const toolResultLine = JSON.stringify({
  content: [{ type: "tool_result", content: "file1\nfile2", is_error: false }],
});

const toolResultErrorLine = JSON.stringify({
  content: [{ type: "tool_result", content: "boom failed", is_error: true }],
});

const rawLine = "a raw unparsable fragment";

const fullOutput = [textLine, toolUseLine, toolResultLine, toolResultErrorLine, rawLine].join(
  "\n",
);

describe("AgentOutputPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows 'Agent Output (completed)' header when there is output but no active process", () => {
    render(<AgentOutputPanel processes={[]} output={fullOutput} />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows runtime, stage and a live indicator when a process is active", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "codex", stage: "AIReview" })]}
        output=""
      />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("AIReview")).toBeDefined();
  });

  it("parses and renders text, tool_use, tool_result (success/error) and raw blocks", () => {
    render(<AgentOutputPanel processes={[]} output={fullOutput} />);

    expect(screen.getByText("Hello from the agent")).toBeDefined();
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();
    expect(
      screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent === "file1\nfile2"),
    ).toBeDefined();
    expect(screen.getByText("boom failed")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText(rawLine)).toBeDefined();
  });

  it("shows the 'Waiting for output...' placeholder when there are no parsed blocks", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles collapsed state when the header is clicked, hiding the body", async () => {
    render(<AgentOutputPanel processes={[]} output={fullOutput} />);

    expect(screen.getByText("Hello from the agent")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /Agent Output/i }));

    expect(screen.queryByText("Hello from the agent")).toBeNull();
  });

  it("toggles between parsed and raw views", async () => {
    render(<AgentOutputPanel processes={[]} output={fullOutput} />);

    // Parsed view initially — raw JSON lines should not appear verbatim
    expect(screen.queryByText(toolUseLine)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "raw" }));

    // Now the raw textual output is shown, and the toggle label flips
    expect(screen.getByRole("button", { name: "parsed" })).toBeDefined();
    const pre = screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent === fullOutput);
    expect(pre).toBeDefined();
  });

  it("shows 'Waiting for output...' in raw view when output is empty", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);

    await userEvent.click(screen.getByRole("button", { name: "raw" }));

    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("collapses the tool_use block content when its header is clicked", async () => {
    render(<AgentOutputPanel processes={[]} output={toolUseLine} />);

    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /Bash/i }));

    expect(screen.queryByText("ls -la")).toBeNull();
  });

  it("renders the elapsed time for an active process and updates as time passes", () => {
    vi.useFakeTimers();
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);

    expect(screen.getByText("5s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(65_000);
    });

    expect(screen.getByText("1m 10s")).toBeDefined();
  });
});
