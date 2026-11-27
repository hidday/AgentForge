import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

let mockBlocks: ParsedBlock[] = [];

vi.mock("@/lib/parseClaudeOutput.ts", () => ({
  parseClaudeOutput: vi.fn(() => mockBlocks),
}));

import { AgentOutputPanel } from "./AgentOutputPanel.tsx";

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
  beforeEach(() => {
    mockBlocks = [];
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the panel when output is present even with no active process", () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText(/agent output \(completed\)/i)).toBeDefined();
  });

  it("renders the panel when a process is active even with empty output", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("shows runtime/stage/elapsed timer for the active process and formats seconds-only elapsed time", () => {
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "codex", stage: "AIReview", startedAt })]}
        output=""
      />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("AIReview")).toBeDefined();

    vi.advanceTimersByTime(1_000);
    expect(screen.getByText(/^\d+s$/)).toBeDefined();
  });

  it("formats elapsed time with minutes once over 60 seconds", () => {
    const startedAt = new Date(Date.now() - 65_000).toISOString();
    render(
      <AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />,
    );

    vi.advanceTimersByTime(1_000);
    expect(screen.getByText(/^\d+m \d+s$/)).toBeDefined();
  });

  it("shows 'Agent Output (completed)' label and no pulse dot when there is no active process", () => {
    render(<AgentOutputPanel processes={[]} output="done output" />);
    expect(screen.getByText(/agent output \(completed\)/i)).toBeDefined();
    expect(document.querySelector(".animate-pulse")).toBeNull();
  });

  it("toggles collapsed state when the header button is clicked", async () => {
    mockBlocks = [{ type: "text", content: "hello" }];
    render(<AgentOutputPanel processes={[]} output="hello" />);

    expect(screen.getByText("hello")).toBeDefined();

    const header = screen.getByRole("button", { name: /agent output \(completed\)/i });
    await userEvent.click(header);
    expect(screen.queryByText("hello")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("auto-expands (un-collapses) when a process transitions from inactive to active", async () => {
    mockBlocks = [{ type: "text", content: "line one" }];
    const { rerender } = render(<AgentOutputPanel processes={[]} output="line one" />);

    const header = screen.getByRole("button", { name: /agent output \(completed\)/i });
    await userEvent.click(header);
    expect(screen.queryByText("line one")).toBeNull();

    // Process becomes active — should auto re-expand via startTransition effect
    rerender(<AgentOutputPanel processes={[makeProcess()]} output="line one" />);

    expect(await screen.findByText("line one")).toBeDefined();
  });

  it("shows 'Waiting for output...' placeholder in parsed view when there are no blocks", () => {
    mockBlocks = [];
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText(/waiting for output/i)).toBeDefined();
  });

  it("toggles between parsed and raw views, and raw view shows the raw output text", async () => {
    mockBlocks = [{ type: "text", content: "parsed text" }];
    render(<AgentOutputPanel processes={[]} output="raw line 1\nraw line 2" />);

    expect(screen.getByText("parsed text")).toBeDefined();

    const toggle = screen.getByRole("button", { name: /^raw$/i });
    await userEvent.click(toggle);

    expect(screen.getByText(/raw line 1/)).toBeDefined();
    expect(screen.queryByText("parsed text")).toBeNull();
    expect(screen.getByRole("button", { name: /^parsed$/i })).toBeDefined();
  });

  it("shows 'Waiting for output...' in raw view when output is empty", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    const toggle = screen.getByRole("button", { name: /^raw$/i });
    await userEvent.click(toggle);
    expect(screen.getByText(/waiting for output/i)).toBeDefined();
  });

  describe("BlockRenderer", () => {
    it("renders a text block", () => {
      mockBlocks = [{ type: "text", content: "Hello from the agent" }];
      render(<AgentOutputPanel processes={[]} output="x" />);
      expect(screen.getByText("Hello from the agent")).toBeDefined();
    });

    it("renders a tool_use block collapsed/expanded toggle and its content", async () => {
      mockBlocks = [{ type: "tool_use", toolName: "Bash", content: "ls -la" }];
      render(<AgentOutputPanel processes={[]} output="x" />);

      expect(screen.getByText("Bash")).toBeDefined();
      expect(screen.getByText("ls -la")).toBeDefined();

      const toolToggle = screen.getByText("Bash").closest("button") as HTMLButtonElement;
      await userEvent.click(toolToggle);
      expect(screen.queryByText("ls -la")).toBeNull();

      await userEvent.click(toolToggle);
      expect(screen.getByText("ls -la")).toBeDefined();
    });

    it("renders a tool_use block with no content without crashing (no pre shown)", () => {
      mockBlocks = [{ type: "tool_use", toolName: "Read", content: "" }];
      render(<AgentOutputPanel processes={[]} output="x" />);
      expect(screen.getByText("Read")).toBeDefined();
    });

    it("renders a non-error tool_result block without the Error label", () => {
      mockBlocks = [{ type: "tool_result", content: "stdout ok", isError: false }];
      render(<AgentOutputPanel processes={[]} output="x" />);
      expect(screen.getByText("stdout ok")).toBeDefined();
      expect(screen.queryByText("Error")).toBeNull();
    });

    it("renders an error tool_result block with the Error label", () => {
      mockBlocks = [{ type: "tool_result", content: "boom failed", isError: true }];
      render(<AgentOutputPanel processes={[]} output="x" />);
      expect(screen.getByText("boom failed")).toBeDefined();
      expect(screen.getByText("Error")).toBeDefined();
    });

    it("renders an error block", () => {
      mockBlocks = [{ type: "error", content: "Fatal parse error" }];
      render(<AgentOutputPanel processes={[]} output="x" />);
      expect(screen.getByText("Fatal parse error")).toBeDefined();
    });

    it("renders a raw fallback block", () => {
      mockBlocks = [{ type: "raw", content: "unrecognized line" }];
      render(<AgentOutputPanel processes={[]} output="x" />);
      expect(screen.getByText("unrecognized line")).toBeDefined();
    });

    it("renders multiple blocks together in order", () => {
      mockBlocks = [
        { type: "text", content: "intro" },
        { type: "tool_use", toolName: "Grep", content: "pattern" },
        { type: "error", content: "oops" },
      ];
      render(<AgentOutputPanel processes={[]} output="x" />);
      expect(screen.getByText("intro")).toBeDefined();
      expect(screen.getByText("Grep")).toBeDefined();
      expect(screen.getByText("oops")).toBeDefined();
    });
  });
});
