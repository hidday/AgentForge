import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

// The parser's own behavior is covered by parseClaudeOutput.test.ts. Mocking it
// here lets us deterministically exercise every block-rendering branch of
// AgentOutputPanel without needing to hand-craft exact NDJSON strings.
vi.mock("@/lib/parseClaudeOutput.ts", () => ({
  parseClaudeOutput: vi.fn(),
}));

import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import { parseClaudeOutput } from "@/lib/parseClaudeOutput.ts";

const mockParse = parseClaudeOutput as unknown as ReturnType<typeof vi.fn>;

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 1234,
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

  it("shows the completed label when output exists but there is no active process", () => {
    mockParse.mockReturnValue([{ type: "text", content: "Hello world" } as ParsedBlock]);
    render(<AgentOutputPanel processes={[]} output="some output" />);

    expect(screen.getByText(/Agent Output \(completed\)/i)).toBeDefined();
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("shows runtime, stage, and elapsed time for an active process", () => {
    const proc = makeProcess({ runtime: "claude-code", stage: "Implementing" });
    render(<AgentOutputPanel processes={[proc]} output="" />);

    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    // ElapsedTimer renders "<secs>s" immediately on mount when under a minute.
    expect(screen.getByText(/^\d+s$/)).toBeDefined();
  });

  it("formats elapsed time with minutes once over 60 seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:02:05Z"));
    const proc = makeProcess({ startedAt: "2024-01-01T00:00:00Z" });

    render(<AgentOutputPanel processes={[proc]} output="" />);

    expect(screen.getByText("2m 5s")).toBeDefined();
  });

  it("shows 'Waiting for output...' in the parsed view when there are no blocks", () => {
    mockParse.mockReturnValue([]);
    const proc = makeProcess();
    render(<AgentOutputPanel processes={[proc]} output="" />);

    expect(screen.getByText(/waiting for output/i)).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "Parsed text" } as ParsedBlock]);
    render(<AgentOutputPanel processes={[]} output="raw output string" />);

    expect(screen.getByText("Parsed text")).toBeDefined();
    expect(screen.queryByText("raw output string")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "raw" }));

    expect(screen.getByText("raw output string")).toBeDefined();
    expect(screen.queryByText("Parsed text")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "parsed" }));
    expect(screen.getByText("Parsed text")).toBeDefined();
  });

  it("shows the raw placeholder text when output is empty and raw view is selected", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByRole("button", { name: "raw" }));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("collapses and expands the panel when the header is clicked", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "Visible text" } as ParsedBlock]);
    render(<AgentOutputPanel processes={[]} output="x" />);

    expect(screen.getByText("Visible text")).toBeDefined();

    await userEvent.click(screen.getByText(/Agent Output \(completed\)/i));
    expect(screen.queryByText("Visible text")).toBeNull();

    await userEvent.click(screen.getByText(/Agent Output \(completed\)/i));
    expect(screen.getByText("Visible text")).toBeDefined();
  });

  it("auto-expands when a process transitions from inactive to active", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "Block content" } as ParsedBlock]);
    const { rerender } = render(<AgentOutputPanel processes={[]} output="x" />);

    // Manually collapse first.
    await userEvent.click(screen.getByText(/Agent Output \(completed\)/i));
    expect(screen.queryByText("Block content")).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output="x" />);

    await waitFor(() => {
      expect(screen.getByText("Block content")).toBeDefined();
    });
  });

  it("renders a text block", () => {
    mockParse.mockReturnValue([{ type: "text", content: "Agent says hi" } as ParsedBlock]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Agent says hi")).toBeDefined();
  });

  it("renders a tool_use block expanded by default and collapses it on click", async () => {
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

  it("does not render a content block for tool_use with empty content", () => {
    mockParse.mockReturnValue([
      { type: "tool_use", toolName: "Read", content: "" } as ParsedBlock,
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Read")).toBeDefined();
  });

  it("renders a successful tool_result block without an Error label", () => {
    mockParse.mockReturnValue([
      { type: "tool_result", content: "it worked", isError: false } as ParsedBlock,
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);

    expect(screen.getByText("it worked")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders a failed tool_result block with an Error label", () => {
    mockParse.mockReturnValue([
      { type: "tool_result", content: "boom", isError: true } as ParsedBlock,
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);

    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("renders an error block", () => {
    mockParse.mockReturnValue([
      { type: "error", content: "Fatal failure" } as ParsedBlock,
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Fatal failure")).toBeDefined();
  });

  it("renders unrecognized/raw block types through the fallback renderer", () => {
    mockParse.mockReturnValue([{ type: "raw", content: "stray stdout line" } as ParsedBlock]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("stray stdout line")).toBeDefined();
  });

  it("renders multiple blocks together in order", () => {
    mockParse.mockReturnValue([
      { type: "text", content: "First" } as ParsedBlock,
      { type: "tool_use", toolName: "Grep", content: "pattern" } as ParsedBlock,
      { type: "tool_result", content: "match found", isError: false } as ParsedBlock,
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);

    expect(screen.getByText("First")).toBeDefined();
    expect(screen.getByText("Grep")).toBeDefined();
    expect(screen.getByText("match found")).toBeDefined();
  });
});
