import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    stage: "executor",
    runtime: "claudeCode",
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

  it("renders the completed label when there is output but no active process", () => {
    render(<AgentOutputPanel processes={[]} output="Analyzing the task..." />);
    expect(screen.getByText(/Agent Output \(completed\)/i)).toBeDefined();
  });

  it("renders the runtime and stage for an active process", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "codex", stage: "planner" })]}
        output=""
      />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("planner")).toBeDefined();
  });

  it("shows an elapsed timer in seconds for a recently started process", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ startedAt: new Date().toISOString() })]}
        output=""
      />,
    );
    expect(screen.getByText(/^\d+s$/)).toBeDefined();
  });

  it("formats elapsed time in minutes and seconds once a minute has passed", () => {
    const startedAt = new Date(Date.now() - 65_000).toISOString();
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText(/^1m \d+s$/)).toBeDefined();
  });

  it("toggles collapsed state when the header is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AgentOutputPanel processes={[]} output="Some output text" />);

    expect(screen.getByText("Some output text")).toBeDefined();
    await user.click(screen.getByRole("button", { name: /Agent Output/i }));
    expect(screen.queryByText("Some output text")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Agent Output/i }));
    expect(screen.getByText("Some output text")).toBeDefined();
  });

  it("shows the parsed waiting placeholder when output is empty but a process is active", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText(/Waiting for output/i)).toBeDefined();
  });

  it("renders a parsed text block from NDJSON stream output", () => {
    const raw = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello from the agent" },
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={raw} />);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("renders a tool_use block with its tool name and toggles expanded content", async () => {
    const user = userEvent.setup({ delay: null });
    const raw = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={raw} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /Bash/i }));
    expect(screen.queryByText("ls -la")).toBeNull();
  });

  it("renders a tool_result error block with the Error label", () => {
    const raw = JSON.stringify({ tool_use_result: "Error: file not found" });
    render(<AgentOutputPanel processes={[makeProcess()]} output={raw} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Error: file not found")).toBeDefined();
  });

  it("switches to raw view showing the unparsed JSON, and back to the parsed text", async () => {
    const user = userEvent.setup({ delay: null });
    const raw = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello from the agent" },
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={raw} />);

    // Parsed view: only the extracted text, no raw JSON punctuation.
    expect(screen.getByText("Hello from the agent")).toBeDefined();
    expect(screen.queryByText(/"type":"content_block_delta"/)).toBeNull();

    await user.click(screen.getByRole("button", { name: /^raw$/i }));
    expect(screen.getByText(/"type":"content_block_delta"/)).toBeDefined();

    await user.click(screen.getByRole("button", { name: /^parsed$/i }));
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("shows a pulsing indicator and amber terminal icon while a process is active", () => {
    const { container } = render(
      <AgentOutputPanel processes={[makeProcess()]} output="" />,
    );
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });
});
