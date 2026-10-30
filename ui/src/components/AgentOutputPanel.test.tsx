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
    vi.clearAllMocks();
    mockParse.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the completed header when output exists but there is no active process", () => {
    mockParse.mockReturnValue([{ type: "text", content: "hello" } as ParsedBlock]);
    render(<AgentOutputPanel processes={[]} output="hello" />);
    expect(screen.getByText(/agent output \(completed\)/i)).toBeDefined();
  });

  it("renders the active process header with runtime, stage, and elapsed timer", () => {
    const proc = makeProcess({ runtime: "codex", stage: "Planning" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("collapses and expands the panel on header click", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "hello world" } as ParsedBlock]);
    render(<AgentOutputPanel processes={[]} output="hello world" />);
    expect(screen.getByText("hello world")).toBeDefined();

    const header = screen.getByRole("button", { name: /agent output \(completed\)/i });
    await userEvent.click(header);
    expect(screen.queryByText("hello world")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("hello world")).toBeDefined();
  });

  it("auto-expands when a process transitions from inactive to active", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "body text" } as ParsedBlock]);
    const { rerender } = render(<AgentOutputPanel processes={[]} output="body text" />);

    const header = screen.getByRole("button", { name: /agent output \(completed\)/i });
    await userEvent.click(header);
    expect(screen.queryByText("body text")).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output="body text" />);
    expect(await screen.findByText("body text")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "parsed text" } as ParsedBlock]);
    render(<AgentOutputPanel processes={[]} output="RAW_JSON_LINE" />);
    expect(screen.getByText("parsed text")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /^raw$/i }));
    expect(screen.getByText("RAW_JSON_LINE")).toBeDefined();
    expect(screen.queryByText("parsed text")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /^parsed$/i }));
    expect(screen.getByText("parsed text")).toBeDefined();
  });

  it("shows 'Waiting for output...' in raw view when output is empty but a process is active", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByRole("button", { name: /^raw$/i }));
    expect(screen.getByText(/waiting for output/i)).toBeDefined();
  });

  it("shows 'Waiting for output...' in parsed view when there are no blocks", () => {
    mockParse.mockReturnValue([]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText(/waiting for output/i)).toBeDefined();
  });

  describe("BlockRenderer", () => {
    it("renders a text block", () => {
      mockParse.mockReturnValue([{ type: "text", content: "assistant said hi" } as ParsedBlock]);
      render(<AgentOutputPanel processes={[]} output="x" />);
      expect(screen.getByText("assistant said hi")).toBeDefined();
    });

    it("renders a tool_use block collapsed/expanded by default (expanded) with its content, and toggles on click", async () => {
      mockParse.mockReturnValue([
        { type: "tool_use", toolName: "Bash", content: "ls -la" } as ParsedBlock,
      ]);
      render(<AgentOutputPanel processes={[]} output="x" />);
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
      render(<AgentOutputPanel processes={[]} output="x" />);
      expect(screen.getByText("Read")).toBeDefined();
    });

    it("renders a successful tool_result block without the error styling/label", () => {
      mockParse.mockReturnValue([
        { type: "tool_result", content: "it worked", isError: false } as ParsedBlock,
      ]);
      render(<AgentOutputPanel processes={[]} output="x" />);
      expect(screen.getByText("it worked")).toBeDefined();
      expect(screen.queryByText("Error")).toBeNull();
    });

    it("renders an errored tool_result block with the Error label", () => {
      mockParse.mockReturnValue([
        { type: "tool_result", content: "it failed", isError: true } as ParsedBlock,
      ]);
      render(<AgentOutputPanel processes={[]} output="x" />);
      expect(screen.getByText("it failed")).toBeDefined();
      expect(screen.getByText("Error")).toBeDefined();
    });

    it("renders an error block", () => {
      mockParse.mockReturnValue([{ type: "error", content: "fatal crash" } as ParsedBlock]);
      render(<AgentOutputPanel processes={[]} output="x" />);
      expect(screen.getByText("fatal crash")).toBeDefined();
    });

    it("renders a raw/fallback block via the default renderer", () => {
      mockParse.mockReturnValue([{ type: "raw", content: "unrecognized line" } as ParsedBlock]);
      render(<AgentOutputPanel processes={[]} output="x" />);
      expect(screen.getByText("unrecognized line")).toBeDefined();
    });
  });

  describe("ElapsedTimer", () => {
    it("shows seconds-only format under a minute and updates as time passes", () => {
      vi.useFakeTimers();
      const startedAt = new Date().toISOString();
      render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
      expect(screen.getByText("0s")).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(screen.getByText("5s")).toBeDefined();
    });

    it("shows minutes and seconds once elapsed time exceeds 60s", () => {
      vi.useFakeTimers();
      const startedAt = new Date(Date.now() - 65_000).toISOString();
      render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
      expect(screen.getByText("1m 5s")).toBeDefined();
    });

    it("clears its interval on unmount without throwing", () => {
      vi.useFakeTimers();
      const { unmount } = render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
      unmount();
      expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();
    });
  });
});
