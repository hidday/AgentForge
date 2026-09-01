import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 123,
    command: "claude",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: new Date(Date.now() - 5_000).toISOString(),
    elapsedMs: 5000,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the completed label when output exists but no process is active", () => {
    render(<AgentOutputPanel processes={[]} output="some raw output" />);
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
    render(<AgentOutputPanel processes={[]} output="line of output" />);

    // Expanded by default: "Waiting for output..." or parsed content visible
    expect(screen.getByText(/waiting for output/i)).toBeDefined();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText(/waiting for output/i)).toBeNull();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.getByText(/waiting for output/i)).toBeDefined();
  });

  it("shows a placeholder message when there is no output yet in parsed view", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    const output = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
    });
    render(<AgentOutputPanel processes={[]} output={output} />);

    // Parsed view: shows the tool name
    expect(screen.getByText("Bash")).toBeDefined();

    await userEvent.click(screen.getByText("raw"));
    // Raw view shows the raw JSON string and no longer the parsed tool block
    expect(screen.queryByText("Bash")).toBeNull();
    expect(screen.getByText(output)).toBeDefined();

    await userEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("Bash")).toBeDefined();
  });

  it("renders parsed text blocks", () => {
    const output = JSON.stringify([{ type: "text", text: "Hello from the agent" }]);
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("expands and collapses a tool_use block and shows its content", async () => {
    const output = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Read", input: { file_path: "/tmp/a.txt" } },
    });
    render(<AgentOutputPanel processes={[]} output={output} />);

    // Expanded by default, content visible
    expect(screen.getByText("/tmp/a.txt")).toBeDefined();

    await userEvent.click(screen.getByText("Read"));
    expect(screen.queryByText("/tmp/a.txt")).toBeNull();

    await userEvent.click(screen.getByText("Read"));
    expect(screen.getByText("/tmp/a.txt")).toBeDefined();
  });

  it("renders a tool_result error block with an Error label", () => {
    const output = JSON.stringify({ tool_use_result: "Error: file not found" });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Error: file not found")).toBeDefined();
  });

  it("renders a non-error tool_result block without an Error label", () => {
    const output = JSON.stringify({ tool_use_result: "all good" });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.queryByText("Error")).toBeNull();
    expect(screen.getByText("all good")).toBeDefined();
  });

  it("renders a tool_result block with is_error content from the content array", () => {
    const output = JSON.stringify([{ type: "tool_result", content: "boom", is_error: true }]);
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
  });

  it("keeps the panel expanded (auto-un-collapse) when a process transitions from inactive to active", () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output="" />);
    // Nothing rendered initially (no output, no process)
    rerender(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders multiple processes but only reads the first one for the header", () => {
    render(
      <AgentOutputPanel
        processes={[
          makeProcess({ id: "p1", runtime: "codex", stage: "Planning" }),
          makeProcess({ id: "p2", runtime: "claude-code", stage: "Implementing" }),
        ]}
        output=""
      />,
    );
    const header = within(screen.getByText("codex").closest("button")!);
    expect(header.getByText("Planning")).toBeDefined();
    expect(screen.queryByText("claude-code")).toBeNull();
  });
});
