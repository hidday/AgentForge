import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";

// parseClaudeOutput never actually produces a "error"-typed ParsedBlock (verified against its
// source), so the AgentOutputPanel's dedicated error-block rendering branch can only be exercised
// by mocking the parser directly for this one case.
vi.mock("@/lib/parseClaudeOutput.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/parseClaudeOutput.ts")>();
  return {
    ...actual,
    parseClaudeOutput: vi.fn(actual.parseClaudeOutput),
  };
});
import { parseClaudeOutput } from "@/lib/parseClaudeOutput.ts";
const mockParse = parseClaudeOutput as unknown as ReturnType<typeof vi.fn>;

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 1,
    command: "npm test",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude",
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

  it("shows the completed label when output exists but no process is active", () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows runtime, stage and a live timer for an active process", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "claude", stage: "Planning" })]}
        output=""
      />,
    );
    expect(screen.getByText("claude")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("shows a placeholder message when there is no parsed output yet", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles collapsed state when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="hello" />);
    expect(screen.getByText(/raw/i)).toBeDefined();

    const header = screen.getByText("claude").closest("button")!;
    await userEvent.click(header);
    expect(screen.queryByText(/raw/i)).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText(/raw/i)).toBeDefined();
  });

  it("switches between parsed and raw views", async () => {
    const rawOutput = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello from the agent" },
    });
    render(<AgentOutputPanel processes={[makeProcess()]} output={rawOutput} />);

    // Parsed view shows the extracted text.
    expect(screen.getByText("Hello from the agent")).toBeDefined();

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("parsed")).toBeDefined();
    expect(screen.getByText(rawOutput)).toBeDefined();
  });

  it("renders a collapsible tool_use block and toggles its expanded content", async () => {
    const rawOutput = JSON.stringify([
      { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
    ]);
    render(<AgentOutputPanel processes={[makeProcess()]} output={rawOutput} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a tool_result error block with error styling", () => {
    const rawOutput = JSON.stringify([
      { type: "tool_result", content: "boom", is_error: true },
    ]);
    render(<AgentOutputPanel processes={[makeProcess()]} output={rawOutput} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("renders a successful tool_result block without the error label", () => {
    const rawOutput = JSON.stringify([
      { type: "tool_result", content: "ok output", is_error: false },
    ]);
    render(<AgentOutputPanel processes={[makeProcess()]} output={rawOutput} />);
    expect(screen.queryByText("Error")).toBeNull();
    expect(screen.getByText("ok output")).toBeDefined();
  });

  it("renders an 'error' block type distinctly (BlockRenderer's error branch)", () => {
    mockParse.mockReturnValueOnce([{ type: "error", content: "Fatal agent error" }]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="irrelevant" />);
    expect(screen.getByText("Fatal agent error")).toBeDefined();
  });

  it("shows the waiting placeholder in raw view when output is empty", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders raw non-JSON lines as raw blocks", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="plain unrecognized line" />);
    expect(screen.getByText("plain unrecognized line")).toBeDefined();
  });

  it("updates the elapsed timer over time for an active process", () => {
    vi.useFakeTimers();
    const startedAt = new Date().toISOString();
    render(
      <AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />,
    );

    const header = screen.getByText("claude").closest("button")!;
    expect(within(header).getByText("0s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(within(header).getByText("5s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(within(header).getByText(/1m 5s/)).toBeDefined();
  });
});
