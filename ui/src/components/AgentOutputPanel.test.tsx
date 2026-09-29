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

const TEXT_LINE = JSON.stringify({
  content: [{ type: "text", text: "Hello from agent" }],
});
const TOOL_USE_LINE = JSON.stringify({
  content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
});
const TOOL_RESULT_OK_LINE = JSON.stringify({
  content: [{ type: "tool_result", content: "all good" }],
});
const TOOL_RESULT_ERR_LINE = JSON.stringify({
  content: [{ type: "tool_result", content: "boom", is_error: true }],
});

describe("AgentOutputPanel", () => {
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the header for a completed run when output exists but there is no active process", () => {
    render(<AgentOutputPanel processes={[]} output={TEXT_LINE} />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders the active process runtime, stage, and elapsed timer when a process is active", () => {
    const proc = makeProcess({ runtime: "claude-code", stage: "Implementing" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    // ElapsedTimer starts near 0s
    expect(screen.getByText(/^\d+s$/)).toBeDefined();
  });

  it("renders parsed text content by default", () => {
    render(<AgentOutputPanel processes={[]} output={TEXT_LINE} />);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("shows 'Waiting for output...' in parsed view when output produces no blocks", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    render(<AgentOutputPanel processes={[]} output={TEXT_LINE} />);
    expect(screen.getByText("Hello from agent")).toBeDefined();

    const toggleBtn = screen.getByText("raw");
    await userEvent.click(toggleBtn);

    // Raw view shows the literal NDJSON string, not the parsed text
    expect(screen.queryByText("Hello from agent")).toBeNull();
    expect(screen.getByText("parsed")).toBeDefined();
    expect(screen.getByText((_, el) => el?.textContent === TEXT_LINE)).toBeDefined();

    await userEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("collapses and expands the panel when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[]} output={TEXT_LINE} />);
    expect(screen.getByText("Hello from agent")).toBeDefined();

    const header = screen.getByText("Agent Output (completed)").closest("button")!;
    await userEvent.click(header);
    expect(screen.queryByText("Hello from agent")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("renders a tool_use block and toggles its expanded input on click", async () => {
    render(<AgentOutputPanel processes={[]} output={TOOL_USE_LINE} />);
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a successful tool_result block without an error indicator", () => {
    render(<AgentOutputPanel processes={[]} output={TOOL_RESULT_OK_LINE} />);
    expect(screen.getByText("all good")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders an errored tool_result block with an error indicator", () => {
    render(<AgentOutputPanel processes={[]} output={TOOL_RESULT_ERR_LINE} />);
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
  });

  it("renders a non-JSON output line as a raw fallback block", () => {
    render(<AgentOutputPanel processes={[]} output="Plain unstructured output line" />);
    expect(screen.getByText("Plain unstructured output line")).toBeDefined();
  });
});
