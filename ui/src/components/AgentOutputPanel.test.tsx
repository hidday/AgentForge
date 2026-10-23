import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "claude",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    elapsedMs: 1000,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders process runtime/stage header and a live indicator when a process is active", () => {
    render(
      <AgentOutputPanel processes={[makeProcess({ runtime: "codex", stage: "Planning" })]} output="" />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("shows 'Agent Output (completed)' when output exists but there is no active process", () => {
    render(<AgentOutputPanel processes={[]} output="some output text" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows a waiting placeholder when there are no parsed blocks yet", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("parses and renders text blocks from Claude Code NDJSON output", () => {
    const output = JSON.stringify({ content: [{ type: "text", text: "Hello from agent" }] });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    const output = JSON.stringify({ content: [{ type: "text", text: "Parsed text" }] });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Parsed text")).toBeDefined();
    const toggleBtn = screen.getByRole("button", { name: "raw" });
    await userEvent.click(toggleBtn);

    // Raw view shows the exact raw NDJSON string instead of the parsed block
    expect(screen.queryByText("Parsed text")).toBeNull();
    expect(screen.getByRole("button", { name: "parsed" })).toBeDefined();
  });

  it("collapses the panel content when the header is clicked", async () => {
    const output = JSON.stringify({ content: [{ type: "text", text: "Visible text" }] });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Visible text")).toBeDefined();
    const header = screen.getByText("Agent Output (completed)");
    await userEvent.click(header);

    expect(screen.queryByText("Visible text")).toBeNull();
  });

  it("renders a tool_use block with its tool name and expandable input, toggling collapse", async () => {
    const output = JSON.stringify({
      content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
    });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();
  });

  it("renders an error tool_result with the Error label and red styling", () => {
    const output = JSON.stringify({
      content: [{ type: "tool_result", content: "boom", is_error: true }],
    });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });
});
