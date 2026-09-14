import { describe, it, expect, vi, afterEach } from "vitest";
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

describe("AgentOutputPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the completed label when output exists but there is no active process", () => {
    render(<AgentOutputPanel processes={[]} output="hello" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the runtime, stage, and elapsed timer for an active process", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "claude-code", stage: "Implementing" })]}
        output=""
      />,
    );
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("shows a waiting message when there is no parseable output yet", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("shows the waiting placeholder in raw view too, when output is empty", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("formats elapsed time in minutes and seconds once over a minute has passed", () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString(); // 90s ago
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText(/^1m \d+s$/)).toBeDefined();
  });

  it("collapses and expands the panel body when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="some output" />);
    // Body visible initially (active process auto-expands)
    expect(screen.getByText("raw")).toBeDefined();

    const header = screen.getByText("claude-code").closest("button") as HTMLButtonElement;
    await userEvent.click(header);
    expect(screen.queryByText("raw")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("raw")).toBeDefined();
  });

  it("toggles between parsed and raw output views", async () => {
    const output = JSON.stringify({ content: [{ type: "text", text: "Hello agent" }] });
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);

    expect(screen.getByText("Hello agent")).toBeDefined();

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("parsed")).toBeDefined();
    expect(screen.getByText(output)).toBeDefined();

    await userEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("Hello agent")).toBeDefined();
  });

  it("renders a tool_use block and toggles its expanded detail on click", async () => {
    const output = JSON.stringify({
      content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a successful tool_result block without the error styling", () => {
    const output = JSON.stringify({
      content: [{ type: "tool_result", content: "build ok" }],
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);
    expect(screen.getByText("build ok")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders an errored tool_result block with error styling", () => {
    const output = JSON.stringify({
      content: [{ type: "tool_result", content: "boom", is_error: true }],
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
  });

  it("renders an unparseable non-noise line as raw fallback content", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="totally not json" />);
    expect(screen.getByText("totally not json")).toBeDefined();
  });
});
