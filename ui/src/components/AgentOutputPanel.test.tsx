import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

function makeProcess(overrides: Partial<ActiveProcess>): ActiveProcess {
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

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentOutputPanel", () => {
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the completed header when output is present but no process is active", () => {
    render(<AgentOutputPanel processes={[]} output="some prior output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders the active process header with runtime and stage", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "codex", stage: "Planning" })]}
        output=""
      />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("shows 'Waiting for output...' in the parsed view when output is empty", () => {
    render(<AgentOutputPanel processes={[makeProcess({})]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("collapses and re-expands the body when the header is clicked", async () => {
    const user = userEvent.setup();
    render(<AgentOutputPanel processes={[makeProcess({})]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();

    const header = screen.getByText("claude-code").closest("button")!;
    await user.click(header);
    expect(screen.queryByText("Waiting for output...")).toBeNull();

    await user.click(header);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    const user = userEvent.setup();
    const output = JSON.stringify([{ type: "text", text: "Hello agent" }]);
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Hello agent")).toBeDefined();

    await user.click(screen.getByText("raw"));
    expect(screen.getByText("parsed")).toBeDefined();
    // Raw view renders the untouched NDJSON string in a <pre>
    expect(screen.getByText(output)).toBeDefined();

    await user.click(screen.getByText("parsed"));
    expect(screen.getByText("Hello agent")).toBeDefined();
  });

  it("shows the raw fallback placeholder when output is empty and raw view is selected", async () => {
    const user = userEvent.setup();
    render(<AgentOutputPanel processes={[makeProcess({})]} output="" />);
    await user.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("parses and renders text, tool_use, tool_result (ok/error), and raw blocks", async () => {
    const user = userEvent.setup();
    const lines = [
      JSON.stringify({ type: "message_start" }), // filtered out (skippable)
      JSON.stringify([{ type: "text", text: "Hello " }]),
      JSON.stringify([{ type: "text", text: "world" }]), // merges into "Hello world"
      JSON.stringify([{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }]),
      JSON.stringify([{ type: "tool_result", content: "file1\nfile2", is_error: false }]),
      JSON.stringify([{ type: "tool_result", content: "boom", is_error: true }]),
      JSON.stringify({ tool_use_result: "Error: hard failure" }),
      JSON.stringify({ tool_use_result: { stdout: "build ok", stderr: "" } }),
      JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "streamed" },
      }),
      JSON.stringify({
        type: "content_block_start",
        content_block: { type: "tool_use", name: "Read", input: { file_path: "/tmp/x.txt" } },
      }),
      "a raw unparsable output line",
    ].join("\n");

    render(<AgentOutputPanel processes={[]} output={lines} />);

    expect(screen.getByText("Hello world")).toBeDefined();
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();
    expect(screen.getByText(/file1/)).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getByText("Error: hard failure")).toBeDefined();
    expect(screen.getByText("build ok")).toBeDefined();
    expect(screen.getByText("streamed")).toBeDefined();
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("/tmp/x.txt")).toBeDefined();
    expect(screen.getByText("a raw unparsable output line")).toBeDefined();

    // Error indicator shown for the errored tool_result block
    expect(screen.getAllByText("Error").length).toBeGreaterThan(0);

    // Tool use blocks are expanded by default; clicking collapses the input
    expect(screen.getByText("ls -la")).toBeDefined();
    await user.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();
    await user.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders elapsed time as seconds-only when under a minute, and updates as time passes", () => {
    vi.useFakeTimers();
    const fixedNow = new Date("2024-01-01T00:05:00Z").getTime();
    vi.setSystemTime(fixedNow);
    const startedAt = new Date(fixedNow - 30_000).toISOString();

    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText("30s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("31s")).toBeDefined();
  });

  it("renders elapsed time in 'Xm Ys' format once a minute has passed", () => {
    vi.useFakeTimers();
    const fixedNow = new Date("2024-01-01T00:05:00Z").getTime();
    vi.setSystemTime(fixedNow);
    const startedAt = new Date(fixedNow - 65_000).toISOString();

    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText("1m 5s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("1m 6s")).toBeDefined();
  });

  it("auto-expands when a process transitions from inactive to active", async () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output="prior output" />);
    // Manually collapse first
    const user = userEvent.setup();
    await user.click(screen.getByText("Agent Output (completed)").closest("button")!);
    expect(screen.queryByText("raw")).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess({})]} output="prior output" />);
    // Panel should auto re-expand once a process becomes active
    expect(await screen.findByText("raw")).toBeDefined();
  });
});
