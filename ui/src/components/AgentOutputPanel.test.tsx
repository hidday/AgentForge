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

describe("AgentOutputPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows 'Agent Output (completed)' header when there is output but no active process", () => {
    render(<AgentOutputPanel processes={[]} output="some leftover output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the runtime and stage for an active process", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "claude-code", stage: "Planning" })]}
        output=""
      />,
    );
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("shows a 'Waiting for output...' placeholder in parsed view when output is empty", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders a parsed text block from NDJSON content", () => {
    const output = JSON.stringify({ content: [{ type: "text", text: "Hello from agent" }] });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("renders a tool_use block with the tool name and its input, and can collapse it", async () => {
    const output = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
    });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a tool_result error block with an Error label and red styling", () => {
    const output = JSON.stringify({ tool_use_result: "Error: something broke" });
    const { container } = render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Error: something broke")).toBeDefined();
    expect(container.querySelector(".border-red-500\\/50")).not.toBeNull();
  });

  it("renders a raw unparseable line as plain text", () => {
    const output = "this is not json at all";
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("this is not json at all")).toBeDefined();
  });

  it("shows 'Waiting for output...' in parsed view when there are no renderable blocks", () => {
    // A line that parses as noise/metadata produces zero blocks.
    const output = JSON.stringify({ usage: { input_tokens: 5 } });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    const output = JSON.stringify({ content: [{ type: "text", text: "Parsed text" }] });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Parsed text")).toBeDefined();
    expect(screen.queryByText(output)).toBeNull();

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText(output)).toBeDefined();
    expect(screen.queryByText("Parsed text")).toBeNull();

    await userEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("Parsed text")).toBeDefined();
  });

  it("collapses and expands the whole panel when the header is clicked", async () => {
    const output = JSON.stringify({ content: [{ type: "text", text: "Visible text" }] });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Visible text")).toBeDefined();
    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("Visible text")).toBeNull();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.getByText("Visible text")).toBeDefined();
  });

  it("shows an incrementing elapsed timer for an active process", () => {
    vi.useFakeTimers();
    const startedAt = new Date().toISOString();
    render(
      <AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />,
    );
    expect(screen.getByText("0s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText("1m 5s")).toBeDefined();
  });

  it("only reflects the first process when multiple are active", () => {
    render(
      <AgentOutputPanel
        processes={[
          makeProcess({ stage: "Implementing", runtime: "claude-code" }),
          makeProcess({ stage: "Reviewing", runtime: "codex" }),
        ]}
        output=""
      />,
    );
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.queryByText("Reviewing")).toBeNull();
  });
});
