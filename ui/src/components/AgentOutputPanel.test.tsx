import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

vi.mock("@/lib/parseClaudeOutput.ts", () => ({
  parseClaudeOutput: vi.fn(),
}));

import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import { parseClaudeOutput } from "@/lib/parseClaudeOutput.ts";

const mockParse = parseClaudeOutput as unknown as ReturnType<typeof vi.fn>;

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
  beforeEach(() => {
    mockParse.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a completed header when output is present but there is no active process", () => {
    mockParse.mockReturnValue([{ type: "text", content: "Done" }]);
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText(/Agent Output \(completed\)/i)).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("renders an active process header with runtime, stage and elapsed timer", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "codex", stage: "AIReview" })]}
        output=""
      />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("AIReview")).toBeDefined();
  });

  it("shows 'Waiting for output...' in parsed view when there are no blocks", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText(/waiting for output/i)).toBeDefined();
  });

  it("collapses and re-expands content when the header is clicked", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "Hello" }]);
    render(<AgentOutputPanel processes={[]} output="hi" />);

    expect(screen.getByText("Hello")).toBeDefined();

    const header = screen.getByRole("button", { name: /agent output \(completed\)/i });
    await userEvent.click(header);
    expect(screen.queryByText("Hello")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("Hello")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "Parsed text" }]);
    render(<AgentOutputPanel processes={[]} output="raw payload" />);

    expect(screen.getByText("Parsed text")).toBeDefined();
    const toggle = screen.getByRole("button", { name: "raw" });
    await userEvent.click(toggle);

    expect(screen.getByText("raw payload")).toBeDefined();
    expect(screen.queryByText("Parsed text")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "parsed" }));
    expect(screen.getByText("Parsed text")).toBeDefined();
  });

  it("shows 'Waiting for output...' in raw view when output is empty but a process is active", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByRole("button", { name: "raw" }));
    expect(screen.getByText(/waiting for output/i)).toBeDefined();
  });

  it("auto-expands when a process transitions from inactive to active", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "Content" }]);
    const { rerender } = render(<AgentOutputPanel processes={[]} output="x" />);

    const header = screen.getByRole("button", { name: /completed/i });
    await userEvent.click(header);
    expect(screen.queryByText("Content")).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output="x" />);

    await waitFor(() => {
      expect(screen.getByText("Content")).toBeDefined();
    });
  });

  it("renders a tool_use block, toggles its expanded state, and hides content when collapsed", async () => {
    const blocks: ParsedBlock[] = [
      { type: "tool_use", toolName: "Bash", content: "ls -la" },
    ];
    mockParse.mockReturnValue(blocks);
    render(<AgentOutputPanel processes={[]} output="x" />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a tool_use block with empty content without a details pre", () => {
    mockParse.mockReturnValue([{ type: "tool_use", toolName: "Glob", content: "" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Glob")).toBeDefined();
  });

  it("renders a successful tool_result block", () => {
    mockParse.mockReturnValue([
      { type: "tool_result", content: "ok output", isError: false },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("ok output")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders an error tool_result block with an Error label", () => {
    mockParse.mockReturnValue([
      { type: "tool_result", content: "boom", isError: true },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
  });

  it("renders an error block", () => {
    mockParse.mockReturnValue([{ type: "error", content: "Something broke" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Something broke")).toBeDefined();
  });

  it("renders a raw/unknown block type via the fallback renderer", () => {
    mockParse.mockReturnValue([{ type: "raw", content: "unrecognized line" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("unrecognized line")).toBeDefined();
  });

  it("renders the elapsed timer counting seconds, then minutes and seconds", () => {
    vi.useFakeTimers();
    const started = new Date();
    vi.setSystemTime(started);

    render(
      <AgentOutputPanel processes={[makeProcess({ startedAt: started.toISOString() })]} output="" />,
    );
    expect(screen.getByText("0s")).toBeDefined();

    vi.setSystemTime(new Date(started.getTime() + 65_000));
    vi.advanceTimersByTime(1_000);
    expect(screen.getByText("1m 5s")).toBeDefined();
  });
});
