import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

// parseClaudeOutput's real parser never emits a `type: "error"` block today
// (no current NDJSON shape maps to it), but BlockRenderer still has a
// dedicated branch for it as defensive handling for a future/unknown error
// shape. Mock the parser for one test to exercise that branch directly.
vi.mock("@/lib/parseClaudeOutput.ts", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/parseClaudeOutput.ts")>(
      "@/lib/parseClaudeOutput.ts",
    );
  return {
    ...actual,
    parseClaudeOutput: vi.fn(actual.parseClaudeOutput),
  };
});
import { parseClaudeOutput } from "@/lib/parseClaudeOutput.ts";

function makeProcess(partial: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "claude",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    ...partial,
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

  it("shows the completed label when output is present but no process is active", () => {
    // output alone (no process) keeps the panel mounted even though it's "completed"
    render(<AgentOutputPanel processes={[]} output="some text" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the runtime, stage, and a live indicator when a process is active", () => {
    const proc = makeProcess({ runtime: "codex", stage: "AIReview" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("AIReview")).toBeDefined();
  });

  it("toggles collapsed state when the header is clicked", async () => {
    const proc = makeProcess();
    render(<AgentOutputPanel processes={[proc]} output="hello" />);
    expect(screen.getByText("raw")).toBeDefined();

    const header = screen.getAllByRole("button")[0];
    await userEvent.click(header);
    // After collapsing, the raw/parsed toggle button should no longer be present
    expect(screen.queryByText("raw")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("raw")).toBeDefined();
  });

  it("renders parsed text blocks by default", () => {
    const output = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello from the agent" },
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("shows 'Waiting for output...' when there are no parsed blocks yet", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("switches to raw view and shows the unparsed output text", async () => {
    const output = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Parsed text" },
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText(output)).toBeDefined();
    expect(screen.getByText("parsed")).toBeDefined();
  });

  it("shows 'Waiting for output...' in raw view when output is empty but a process is active", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders a tool_use block with its tool name and expandable input, toggling on click", async () => {
    const output = JSON.stringify([
      { type: "tool_use", name: "Read", input: { file_path: "/tmp/a.ts" } },
    ]);
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("/tmp/a.ts")).toBeDefined();

    await userEvent.click(screen.getByText("Read"));
    expect(screen.queryByText("/tmp/a.ts")).toBeNull();
  });

  it("renders a successful tool_result without the error styling or label", () => {
    const output = JSON.stringify([
      { type: "tool_result", content: "all good", is_error: false },
    ]);
    const { container } = render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);
    expect(screen.getByText("all good")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
    expect(container.querySelector(".border-emerald-500\\/40")).not.toBeNull();
  });

  it("renders a tool_result error block with the error styling and label", () => {
    const output = JSON.stringify([
      { type: "tool_result", content: "boom", is_error: true },
    ]);
    render(<AgentOutputPanel processes={[makeProcess()]} output={output} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("renders a raw-fallback block for an unparseable, non-noise line", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="plain unstructured line" />);
    expect(screen.getByText("plain unstructured line")).toBeDefined();
  });

  it("renders an 'error'-type block with the error icon and styling", () => {
    vi.mocked(parseClaudeOutput).mockReturnValueOnce([
      { type: "error", content: "fatal: something went badly wrong" },
    ]);
    const { container } = render(
      <AgentOutputPanel processes={[makeProcess()]} output="irrelevant" />,
    );
    expect(screen.getByText("fatal: something went badly wrong")).toBeDefined();
    expect(container.querySelector(".text-red-400")).not.toBeNull();
  });

  it("updates the elapsed timer display over time for an active process", () => {
    vi.useFakeTimers();
    const startedAt = new Date().toISOString();
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText("0s")).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText("1m 5s")).toBeDefined();
  });
});
