import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
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
    mockParse.mockReset();
    mockParse.mockReturnValue([]);
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the completed header when output is present but there is no active process", () => {
    mockParse.mockReturnValue([]);
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders active process info (runtime/stage) when a process is active", () => {
    const proc = makeProcess({ runtime: "codex", stage: "Planning" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.queryByText("Agent Output (completed)")).toBeNull();
  });

  it("shows 'Waiting for output...' in parsed view when there are no blocks", () => {
    mockParse.mockReturnValue([]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("collapses and expands content when the header button is clicked", async () => {
    mockParse.mockReturnValue([]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="something" />);

    expect(screen.getByText("Waiting for output...")).toBeDefined();

    const header = screen.getByText("Implementing").closest("button")!;
    await userEvent.click(header);
    expect(screen.queryByText("Waiting for output...")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "Hello parsed" } as ParsedBlock]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="raw output text" />);

    expect(screen.getByText("Hello parsed")).toBeDefined();
    expect(screen.queryByText("raw output text")).toBeNull();

    const toggleBtn = screen.getByText("raw");
    await userEvent.click(toggleBtn);

    expect(screen.getByText("raw output text")).toBeDefined();
    expect(screen.queryByText("Hello parsed")).toBeNull();
    expect(screen.getByText("parsed")).toBeDefined();
  });

  it("raw view shows placeholder text when output is empty", async () => {
    mockParse.mockReturnValue([]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  describe("BlockRenderer", () => {
    it("renders a text block", () => {
      mockParse.mockReturnValue([{ type: "text", content: "Agent says hi" } as ParsedBlock]);
      render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
      expect(screen.getByText("Agent says hi")).toBeDefined();
    });

    it("renders a tool_use block with tool name, expanded content by default, and collapses on click", async () => {
      mockParse.mockReturnValue([
        { type: "tool_use", toolName: "Bash", content: "ls -la" } as ParsedBlock,
      ]);
      render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);

      expect(screen.getByText("Bash")).toBeDefined();
      expect(screen.getByText("ls -la")).toBeDefined();

      await userEvent.click(screen.getByText("Bash"));
      expect(screen.queryByText("ls -la")).toBeNull();

      await userEvent.click(screen.getByText("Bash"));
      expect(screen.getByText("ls -la")).toBeDefined();
    });

    it("renders a tool_use block with no content without crashing", () => {
      mockParse.mockReturnValue([
        { type: "tool_use", toolName: "Read", content: "" } as ParsedBlock,
      ]);
      render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
      expect(screen.getByText("Read")).toBeDefined();
    });

    it("renders a non-error tool_result block without the Error label", () => {
      mockParse.mockReturnValue([
        { type: "tool_result", content: "file written", isError: false } as ParsedBlock,
      ]);
      render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
      expect(screen.getByText("file written")).toBeDefined();
      expect(screen.queryByText("Error")).toBeNull();
    });

    it("renders an error tool_result block with the Error label", () => {
      mockParse.mockReturnValue([
        { type: "tool_result", content: "boom", isError: true } as ParsedBlock,
      ]);
      render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
      expect(screen.getByText("boom")).toBeDefined();
      expect(screen.getByText("Error")).toBeDefined();
    });

    it("renders an error block", () => {
      mockParse.mockReturnValue([
        { type: "error", content: "Something went wrong" } as ParsedBlock,
      ]);
      render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
      expect(screen.getByText("Something went wrong")).toBeDefined();
    });

    it("renders a raw/default block type as plain text", () => {
      mockParse.mockReturnValue([{ type: "raw", content: "unparsed line" } as ParsedBlock]);
      render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
      expect(screen.getByText("unparsed line")).toBeDefined();
    });

    it("renders multiple blocks together in order", () => {
      mockParse.mockReturnValue([
        { type: "text", content: "first" } as ParsedBlock,
        { type: "tool_use", toolName: "Grep", content: "pattern" } as ParsedBlock,
        { type: "tool_result", content: "match found", isError: false } as ParsedBlock,
      ]);
      render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
      expect(screen.getByText("first")).toBeDefined();
      expect(screen.getByText("Grep")).toBeDefined();
      expect(screen.getByText("match found")).toBeDefined();
    });
  });

  describe("ElapsedTimer", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("displays seconds only when elapsed is under a minute", () => {
      const now = new Date("2024-01-01T00:00:30Z");
      vi.setSystemTime(now);
      const startedAt = new Date("2024-01-01T00:00:00Z").toISOString();

      render(
        <AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />,
      );

      expect(screen.getByText("30s")).toBeDefined();
    });

    it("displays minutes and seconds once elapsed exceeds a minute, and updates as time passes", () => {
      const now = new Date("2024-01-01T00:01:05Z");
      vi.setSystemTime(now);
      const startedAt = new Date("2024-01-01T00:00:00Z").toISOString();

      render(
        <AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />,
      );

      expect(screen.getByText("1m 5s")).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(screen.getByText("1m 7s")).toBeDefined();
    });
  });
});
