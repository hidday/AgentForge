import { describe, it, expect, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";

// The real parseClaudeOutput() never produces a ParsedBlock of type "error" (see
// ui/src/lib/parseClaudeOutput.ts), but BlockRenderer still has a dedicated branch
// for it. Partially mock the module so one test can force that block type through
// and exercise the branch, while every other test uses the real parser.
vi.mock("@/lib/parseClaudeOutput.ts", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/parseClaudeOutput.ts")>(
      "@/lib/parseClaudeOutput.ts",
    );
  return { ...actual, parseClaudeOutput: vi.fn(actual.parseClaudeOutput) };
});

import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import { parseClaudeOutput } from "@/lib/parseClaudeOutput.ts";

const mockParseClaudeOutput = parseClaudeOutput as unknown as ReturnType<typeof vi.fn>;

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 123,
    command: "claude",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders 'Waiting for output...' when there is an active process but no output yet", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText(/waiting for output/i)).toBeDefined();
  });

  it("shows runtime, stage and elapsed timer for an active process", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:05Z"));
    try {
      render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
      expect(screen.getByText("claude-code")).toBeDefined();
      expect(screen.getByText("Implementing")).toBeDefined();
      // 5 seconds elapsed from startedAt to system time
      expect(screen.getByText("5s")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows 'Agent Output (completed)' label when there is output but no active process", () => {
    render(<AgentOutputPanel processes={[]} output="plain text output" />);
    expect(screen.getByText(/agent output \(completed\)/i)).toBeDefined();
  });

  it("formats elapsed time in minutes and seconds when over a minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    try {
      render(
        <AgentOutputPanel
          processes={[makeProcess({ startedAt: "2024-01-01T00:00:00Z" })]}
          output=""
        />,
      );
      // Advance the fake clock itself (rather than jumping with setSystemTime) so the
      // elapsed-time interval ticks exactly once at the 90-second mark.
      act(() => {
        vi.advanceTimersByTime(90_000);
      });
      expect(screen.getByText("1m 30s")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("toggles collapsed state when the header button is clicked", async () => {
    const user = userEvent.setup();
    render(<AgentOutputPanel processes={[]} output="hello output" />);

    // Expanded by default: parsed view visible (raw toggle button present)
    expect(screen.getByText(/^raw$/i)).toBeDefined();

    const header = screen.getByRole("button", { name: /agent output \(completed\)/i });
    await user.click(header);
    expect(screen.queryByText(/^raw$/i)).toBeNull();

    await user.click(header);
    expect(screen.getByText(/^raw$/i)).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    const user = userEvent.setup();
    const rawOutput = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
    });
    render(<AgentOutputPanel processes={[]} output={rawOutput} />);

    // Parsed view shows the tool name
    expect(screen.getByText("Bash")).toBeDefined();

    const toggle = screen.getByRole("button", { name: /^raw$/i });
    await user.click(toggle);

    // Now showing raw output text and the toggle label flips to "parsed"
    expect(screen.getByText(/^parsed$/i)).toBeDefined();
    expect(screen.getByText(rawOutput)).toBeDefined();
  });

  it("raw view shows 'Waiting for output...' placeholder when output is empty but a process is active", async () => {
    const user = userEvent.setup();
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await user.click(screen.getByRole("button", { name: /^raw$/i }));
    expect(screen.getByText(/waiting for output/i)).toBeDefined();
  });

  it("renders a text block via BlockRenderer", () => {
    const rawOutput = JSON.stringify([{ type: "text", text: "Hello from agent" }]);
    render(<AgentOutputPanel processes={[]} output={rawOutput} />);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("renders a tool_use block, expanded by default, and toggles collapse on click", async () => {
    const user = userEvent.setup();
    const rawOutput = JSON.stringify([
      { type: "tool_use", name: "Read", input: { file_path: "/tmp/foo.ts" } },
    ]);
    render(<AgentOutputPanel processes={[]} output={rawOutput} />);

    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("/tmp/foo.ts")).toBeDefined();

    await user.click(screen.getByText("Read"));
    expect(screen.queryByText("/tmp/foo.ts")).toBeNull();

    await user.click(screen.getByText("Read"));
    expect(screen.getByText("/tmp/foo.ts")).toBeDefined();
  });

  it("renders a tool_result success block without the Error label", () => {
    const rawOutput = JSON.stringify([
      { type: "tool_result", content: "ok output", is_error: false },
    ]);
    render(<AgentOutputPanel processes={[]} output={rawOutput} />);
    expect(screen.getByText("ok output")).toBeDefined();
    expect(screen.queryByText(/^error$/i)).toBeNull();
  });

  it("renders a tool_result error block with the Error label", () => {
    const rawOutput = JSON.stringify([
      { type: "tool_result", content: "boom failure", is_error: true },
    ]);
    render(<AgentOutputPanel processes={[]} output={rawOutput} />);
    expect(screen.getByText("boom failure")).toBeDefined();
    expect(screen.getByText(/^error$/i)).toBeDefined();
  });

  it("renders a parsed 'error' block type with the AlertTriangle error style (defensive branch, forced via a mocked parser)", () => {
    mockParseClaudeOutput.mockReturnValueOnce([
      { type: "error", content: "Fatal parser error" },
    ]);
    render(<AgentOutputPanel processes={[]} output="irrelevant raw text" />);
    expect(screen.getByText("Fatal parser error")).toBeDefined();
  });

  it("renders a top-level error string line as an error block", () => {
    const rawOutput = JSON.stringify({ tool_use_result: "Error: something broke" });
    render(<AgentOutputPanel processes={[]} output={rawOutput} />);
    expect(screen.getByText("Error: something broke")).toBeDefined();
  });

  it("renders a raw/unparseable line using the fallback 'raw' block style", () => {
    render(<AgentOutputPanel processes={[]} output="not json at all, just text" />);
    expect(screen.getByText("not json at all, just text")).toBeDefined();
  });

  it("re-expands the panel automatically when a new active process appears (isActive transition)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AgentOutputPanel processes={[]} output="done output" />);

    const header = screen.getByRole("button", { name: /agent output \(completed\)/i });
    await user.click(header);
    expect(screen.queryByText(/^raw$/i)).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output="done output" />);
    expect(screen.getByText(/^raw$/i)).toBeDefined();
  });

  it("toggles the header chevron icon between collapsed and expanded states without crashing", async () => {
    const user = userEvent.setup();
    const { container } = render(<AgentOutputPanel processes={[]} output="x" />);
    const header = within(container).getByRole("button", {
      name: /agent output \(completed\)/i,
    });
    await user.click(header);
    await user.click(header);
    expect(header).toBeDefined();
  });
});
