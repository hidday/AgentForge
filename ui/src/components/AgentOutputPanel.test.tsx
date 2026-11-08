import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 123,
    command: "claude",
    runId: "run-1",
    stage: "execution",
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

  it("renders the completed label when output exists but there is no active process", () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders process runtime, stage and an elapsed timer when a process is active", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "codex", stage: "planning" })]}
        output=""
      />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("planning")).toBeDefined();
    // ElapsedTimer renders e.g. "0s" immediately on mount.
    expect(screen.getByText(/^\d+s$|^\d+m \d+s$/)).toBeDefined();
  });

  it("formats elapsed time in minutes and seconds once over a minute has passed", () => {
    vi.useFakeTimers();
    const startedAt = new Date(Date.now() - 75_000).toISOString();
    render(
      <AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />,
    );
    expect(screen.getByText("1m 15s")).toBeDefined();
  });

  it("toggles collapsed state when the header button is clicked", async () => {
    const user = userEvent.setup();
    render(<AgentOutputPanel processes={[]} output="hello world" />);
    // Expanded by default: parsed/raw toggle button is visible.
    expect(screen.getByText("raw")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /agent output \(completed\)/i }));
    expect(screen.queryByText("raw")).toBeNull();

    await user.click(screen.getByRole("button", { name: /agent output \(completed\)/i }));
    expect(screen.getByText("raw")).toBeDefined();
  });

  it("auto-expands when a process transitions from inactive to active", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AgentOutputPanel processes={[]} output="hello" />);

    await user.click(screen.getByRole("button", { name: /agent output \(completed\)/i }));
    expect(screen.queryByText("raw")).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output="hello" />);
    expect(await screen.findByText("raw")).toBeDefined();
  });

  it("shows the waiting placeholder in parsed view when there is no parsed output", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles to raw view and shows the waiting placeholder there when output is empty", async () => {
    const user = userEvent.setup();
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await user.click(screen.getByText("raw"));
    expect(screen.getByText("parsed")).toBeDefined();
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders raw output text verbatim in raw view", async () => {
    const user = userEvent.setup();
    const raw = "line one\nline two";
    render(<AgentOutputPanel processes={[]} output={raw} />);
    await user.click(screen.getByText("raw"));
    expect(
      screen.getByText((_, el) => el?.tagName.toLowerCase() === "pre" && el.textContent === raw),
    ).toBeDefined();
  });

  it("renders a text block from parsed NDJSON output", () => {
    const output = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello from the agent" },
    });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("renders a tool_use block, expanded by default, and collapses it on click", async () => {
    const user = userEvent.setup();
    const output = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
    });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await user.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await user.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a successful tool_result block without the error marker", () => {
    const output = JSON.stringify({
      tool_use_result: { stdout: "all good", stderr: "" },
    });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("all good")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders a failed tool_result block with the error marker", () => {
    const output = JSON.stringify({
      tool_use_result: "Error: something broke",
    });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Error: something broke")).toBeDefined();
  });

  it("renders a raw fallback block for an unparseable, non-noise line", () => {
    const output = `${JSON.stringify({ type: "message_start" })}\nnot json at all, and not a metadata-noise fragment either`;
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(
      screen.getByText("not json at all, and not a metadata-noise fragment either"),
    ).toBeDefined();
  });
});
