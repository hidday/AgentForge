import { describe, it, expect } from "vitest";
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
    stage: "Implementing",
    runtime: "claude-code",
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

  it("renders the 'completed' header when output exists but no process is active", () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders runtime and stage for an active process", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "codex", stage: "Planning" })]}
        output=""
      />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("collapses and expands the panel when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[]} output="hello output" />);
    // Parsed view: raw text isn't valid JSON, becomes a 'raw' block.
    expect(screen.getByText("hello output")).toBeDefined();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("hello output")).toBeNull();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.getByText("hello output")).toBeDefined();
  });

  it("shows the waiting placeholder in parsed view when output is empty but a process is active", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    const raw = '[{"type":"text","text":"Hello from agent"}]';
    render(<AgentOutputPanel processes={[]} output={raw} />);

    // Parsed view shows the extracted text content.
    expect(screen.getByText("Hello from agent")).toBeDefined();

    await userEvent.click(screen.getByText("raw"));
    // Raw view shows the raw NDJSON string itself.
    expect(screen.getByText(raw)).toBeDefined();
    expect(screen.getByText("parsed")).toBeDefined();

    await userEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("renders a tool_use block and toggles its expanded input", async () => {
    const raw = '[{"type":"tool_use","name":"Bash","input":{"command":"ls -la"}}]';
    render(<AgentOutputPanel processes={[]} output={raw} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a successful tool_result block without the error label", () => {
    const raw = '[{"type":"tool_result","content":"build succeeded","is_error":false}]';
    render(<AgentOutputPanel processes={[]} output={raw} />);
    expect(screen.getByText("build succeeded")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders a failed tool_result block with the error label", () => {
    const raw = '[{"type":"tool_result","content":"build failed","is_error":true}]';
    render(<AgentOutputPanel processes={[]} output={raw} />);
    expect(screen.getByText("build failed")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
  });
});
