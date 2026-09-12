import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

const mockParse = vi.fn<(raw: string) => ParsedBlock[]>();

vi.mock("@/lib/parseClaudeOutput.ts", () => ({
  parseClaudeOutput: (raw: string) => mockParse(raw),
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
    mockParse.mockReset();
    mockParse.mockReturnValue([]);
  });

  it("renders nothing when output is empty and there is no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the completed header when output exists but no process is active", () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
    expect(document.querySelector(".animate-pulse")).toBeNull();
  });

  it("renders active-process header with runtime, stage and a pulsing indicator", () => {
    const proc = makeProcess({ runtime: "codex", stage: "PlanReview" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("PlanReview")).toBeDefined();
    expect(document.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("shows 'Waiting for output...' in the parsed view when there are no blocks", () => {
    mockParse.mockReturnValue([]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("collapsing the panel hides the body and the raw/parsed toggle", async () => {
    render(<AgentOutputPanel processes={[]} output="hello" />);
    expect(screen.getByText("raw")).toBeDefined();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("raw")).toBeNull();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.getByText("raw")).toBeDefined();
  });

  it("auto-expands when a process transitions from inactive to active", async () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output="hello" />);
    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("raw")).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output="hello" />);
    expect(screen.getByText("raw")).toBeDefined();
  });

  it("toggles between parsed and raw views, showing the raw output text verbatim", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "parsed text" }]);
    render(<AgentOutputPanel processes={[]} output="RAW-NDJSON-LINE" />);

    expect(screen.getByText("parsed text")).toBeDefined();
    expect(screen.queryByText("RAW-NDJSON-LINE")).toBeNull();

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("RAW-NDJSON-LINE")).toBeDefined();
    expect(screen.queryByText("parsed text")).toBeNull();
    expect(screen.getByText("parsed")).toBeDefined();

    await userEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("parsed text")).toBeDefined();
  });

  it("raw view shows placeholder text when output is empty", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders a text block with its content", () => {
    mockParse.mockReturnValue([{ type: "text", content: "Hello from agent" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("renders a tool_use block expanded by default and collapses on click", async () => {
    mockParse.mockReturnValue([
      { type: "tool_use", content: "ls -la", toolName: "Bash" },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a successful tool_result without an Error label", () => {
    mockParse.mockReturnValue([
      { type: "tool_result", content: "build ok", isError: false },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("build ok")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders a failed tool_result with an Error label", () => {
    mockParse.mockReturnValue([
      { type: "tool_result", content: "boom", isError: true },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("renders an error block with its content", () => {
    mockParse.mockReturnValue([{ type: "error", content: "fatal failure" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("fatal failure")).toBeDefined();
  });

  it("renders a raw/default block with its content", () => {
    mockParse.mockReturnValue([{ type: "raw", content: "unrecognized line" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("unrecognized line")).toBeDefined();
  });
});

describe("AgentOutputPanel ElapsedTimer", () => {
  beforeEach(() => {
    mockParse.mockReset();
    mockParse.mockReturnValue([]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows seconds-only format under a minute and updates as time passes", () => {
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText("5s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText("8s")).toBeDefined();
  });

  it("shows minutes and seconds format once elapsed exceeds 60 seconds", () => {
    const startedAt = new Date(Date.now() - 65_000).toISOString();
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText("1m 5s")).toBeDefined();
  });
});
