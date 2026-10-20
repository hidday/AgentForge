import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { ActiveProcess } from "@/api/client.ts";

// Wrap the real parser in a vi.fn so a single test can override its return
// value (to exercise the "error" block branch, which the real parser never
// produces) while every other test keeps exercising the real parsing logic.
vi.mock("@/lib/parseClaudeOutput.ts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/parseClaudeOutput.ts")>(
    "@/lib/parseClaudeOutput.ts",
  );
  return {
    ...actual,
    parseClaudeOutput: vi.fn(actual.parseClaudeOutput),
  };
});

import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import { parseClaudeOutput } from "@/lib/parseClaudeOutput.ts";

const mockParseClaudeOutput = parseClaudeOutput as unknown as ReturnType<typeof vi.fn>;

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 1234,
    command: "claude",
    runId: "run-1",
    stage: "Implementing",
    runtime: "python",
    startedAt: "2024-01-01T00:00:00.000Z",
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
    render(<AgentOutputPanel processes={[]} output="some finished output" />);
    expect(screen.getByText(/agent output \(completed\)/i)).toBeDefined();
  });

  it("shows runtime and stage for an active process", () => {
    const proc = makeProcess({ runtime: "node", stage: "AIReview" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("node")).toBeDefined();
    expect(screen.getByText("AIReview")).toBeDefined();
  });

  it("collapses and expands the content section when the header is clicked", () => {
    render(<AgentOutputPanel processes={[]} output="static output" />);
    // Expanded by default — the parsed/raw toggle is visible
    expect(screen.getByText(/^raw$/i)).toBeDefined();

    const headerButton = screen.getAllByRole("button")[0];
    fireEvent.click(headerButton);
    expect(screen.queryByText(/^raw$/i)).toBeNull();

    fireEvent.click(headerButton);
    expect(screen.getByText(/^raw$/i)).toBeDefined();
  });

  it("toggles between parsed and raw views", () => {
    render(<AgentOutputPanel processes={[]} output="plain text line" />);

    const toggle = screen.getByText(/^raw$/i);
    fireEvent.click(toggle);
    expect(screen.getByText(/^parsed$/i)).toBeDefined();
    // raw view shows the literal output text inside a <pre>
    expect(screen.getByText("plain text line")).toBeDefined();

    fireEvent.click(screen.getByText(/^parsed$/i));
    expect(screen.getByText(/^raw$/i)).toBeDefined();
  });

  it("shows the waiting placeholder in parsed view when there are no blocks", () => {
    const proc = makeProcess();
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText(/waiting for output/i)).toBeDefined();
  });

  it("shows the waiting placeholder in raw view when output is empty", () => {
    const proc = makeProcess();
    render(<AgentOutputPanel processes={[proc]} output="" />);
    fireEvent.click(screen.getByText(/^raw$/i));
    expect(screen.getByText(/waiting for output/i)).toBeDefined();
  });

  it("renders a parsed text block", () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello agent text" },
    });
    render(<AgentOutputPanel processes={[]} output={line} />);
    expect(screen.getByText("Hello agent text")).toBeDefined();
  });

  it("renders a tool_use block and toggles its expanded details", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
    });
    render(<AgentOutputPanel processes={[]} output={line} />);

    expect(screen.getByText("Bash")).toBeDefined();
    // expanded by default
    expect(screen.getByText("ls -la")).toBeDefined();

    fireEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    fireEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a successful tool_result block without an error label", () => {
    const line = JSON.stringify({ tool_use_result: "Build succeeded" });
    render(<AgentOutputPanel processes={[]} output={line} />);
    expect(screen.getByText("Build succeeded")).toBeDefined();
    expect(screen.queryByText(/^error$/i)).toBeNull();
  });

  it("renders a failing tool_result block with an error label", () => {
    const line = JSON.stringify({ tool_use_result: "Error: build failed" });
    render(<AgentOutputPanel processes={[]} output={line} />);
    expect(screen.getByText("Error: build failed")).toBeDefined();
    expect(screen.getByText(/^error$/i)).toBeDefined();
  });

  it("renders unparsable non-JSON lines as a raw fallback block", () => {
    render(<AgentOutputPanel processes={[]} output="totally unstructured log line" />);
    expect(screen.getByText("totally unstructured log line")).toBeDefined();
  });

  it("renders an 'error' type block via the fallback error branch", () => {
    mockParseClaudeOutput.mockReturnValueOnce([
      { type: "error", content: "Something broke badly" },
    ]);
    render(<AgentOutputPanel processes={[]} output="irrelevant" />);
    expect(screen.getByText("Something broke badly")).toBeDefined();
  });

  it("formats the elapsed timer in mins/secs and updates every second", () => {
    vi.useFakeTimers();
    const startedAt = "2024-01-01T00:00:00.000Z";
    vi.setSystemTime(new Date(startedAt));
    const proc = makeProcess({ startedAt });

    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("0s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText("1m 5s")).toBeDefined();
  });

  it("re-expands automatically when a new active process starts while collapsed", async () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output="static output" />);
    const headerButton = screen.getAllByRole("button")[0];
    fireEvent.click(headerButton);
    expect(screen.queryByText(/^raw$/i)).toBeNull();

    const proc = makeProcess();
    rerender(<AgentOutputPanel processes={[proc]} output="static output" />);

    await waitFor(() => {
      expect(screen.queryByText(/^raw$/i)).not.toBeNull();
    });
  });
});
