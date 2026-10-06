import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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

const textLine = JSON.stringify({ content: [{ type: "text", text: "Hello from the agent" }] });
const toolUseLine = JSON.stringify({
  content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
});
const toolResultOkLine = JSON.stringify({
  content: [{ type: "tool_result", content: "file1\nfile2", is_error: false }],
});
const toolResultErrLine = JSON.stringify({
  content: [{ type: "tool_result", content: "Error: boom", is_error: true }],
});

const fullOutput = [textLine, toolUseLine, toolResultOkLine, toolResultErrLine].join("\n");

describe("AgentOutputPanel", () => {
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the 'completed' header and waiting message when active with empty output", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText(/waiting for output/i)).toBeDefined();
  });

  it("renders the completed-state header when there is output but no active process", () => {
    render(<AgentOutputPanel processes={[]} output={fullOutput} />);
    expect(screen.getByText(/agent output \(completed\)/i)).toBeDefined();
  });

  it("renders parsed text, tool_use, and tool_result (success/error) blocks", () => {
    render(<AgentOutputPanel processes={[]} output={fullOutput} />);

    expect(screen.getByText("Hello from the agent")).toBeDefined();
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();
    expect(screen.getByText(/file1/)).toBeDefined();
    expect(screen.getByText("Error: boom")).toBeDefined();
    // The error tool_result block shows an "Error" label
    expect(screen.getByText("Error")).toBeDefined();
  });

  it("toggles a tool_use block's expanded detail on click", async () => {
    render(<AgentOutputPanel processes={[]} output={toolUseLine} />);

    expect(screen.getByText("ls -la")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /bash/i }));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /bash/i }));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    render(<AgentOutputPanel processes={[]} output={fullOutput} />);

    expect(screen.getByText("Hello from the agent")).toBeDefined();
    const toggle = screen.getByRole("button", { name: /^raw$/i });
    await userEvent.click(toggle);

    // Raw view shows the unparsed NDJSON text and the toggle label flips
    expect(screen.getByRole("button", { name: /^parsed$/i })).toBeDefined();
    expect(screen.getByText(textLine, { exact: false })).toBeDefined();
    expect(screen.queryByText("Hello from the agent")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /^parsed$/i }));
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("raw view shows a waiting placeholder when output is empty", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    const toggle = screen.getByRole("button", { name: /^raw$/i });
    await userEvent.click(toggle);
    expect(screen.getByText(/waiting for output/i)).toBeDefined();
  });

  it("collapses and expands the panel body via the header button", async () => {
    render(<AgentOutputPanel processes={[]} output={fullOutput} />);

    expect(screen.getByText("Hello from the agent")).toBeDefined();
    const header = screen.getByRole("button", { name: /agent output \(completed\)/i });
    await userEvent.click(header);
    expect(screen.queryByText("Hello from the agent")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("re-expands automatically when a process transitions from inactive to active", async () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output={fullOutput} />);

    const header = screen.getByRole("button", { name: /agent output \(completed\)/i });
    await userEvent.click(header);
    expect(screen.queryByText("Hello from the agent")).toBeNull();

    // A new process becomes active; the panel should auto re-expand.
    rerender(<AgentOutputPanel processes={[makeProcess()]} output={fullOutput} />);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("renders the runtime/stage header and a live indicator for an active process", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "codex", stage: "AIReview" })]}
        output=""
      />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("AIReview")).toBeDefined();
  });

  it("formats elapsed time in minutes and seconds once past a minute", () => {
    const startedAt = new Date(Date.now() - 125_000).toISOString(); // 2m 5s ago
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText(/^\d+m \d+s$/)).toBeDefined();
  });

  it("formats elapsed time in seconds only when under a minute", () => {
    const startedAt = new Date().toISOString();
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText(/^\d+s$/)).toBeDefined();
  });
});
