import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";

// The real parser is used by default (it's exercised directly in most tests
// below); one test overrides it once to exercise the BlockRenderer's "error"
// block branch, which the real NDJSON parser never actually emits.
vi.mock("@/lib/parseClaudeOutput.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/parseClaudeOutput.ts")>();
  return {
    ...actual,
    parseClaudeOutput: vi.fn(actual.parseClaudeOutput),
  };
});

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
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the completed header when there is output but no active process", () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders the active process header with runtime and stage", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "claude-code", stage: "Planning" })]}
        output=""
      />,
    );
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("shows 'Waiting for output...' in the parsed view when there are no blocks", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("collapses and expands the panel when the header is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AgentOutputPanel processes={[]} output="hello" />);

    expect(screen.getByText("hello")).toBeDefined();

    const header = screen.getByText("Agent Output (completed)").closest("button")!;
    await user.click(header);
    expect(screen.queryByText("hello")).toBeNull();

    await user.click(header);
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("toggles between parsed and raw view", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const rawOutput = JSON.stringify({ type: "ping" }) + "\nnot json raw line";
    render(<AgentOutputPanel processes={[]} output={rawOutput} />);

    const toggle = screen.getByText("raw");
    await user.click(toggle);
    expect(screen.getByText("parsed")).toBeDefined();

    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain("not json raw line");
  });

  it("renders a text block from NDJSON content array output", () => {
    const line = JSON.stringify({
      content: [{ type: "text", text: "Hello from agent" }],
    });
    render(<AgentOutputPanel processes={[]} output={line} />);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("renders a tool_use block and toggles its expanded details", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
    });
    render(<AgentOutputPanel processes={[]} output={line} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await user.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();
  });

  it("renders a tool_result error block with the Error label", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: "boom", is_error: true }],
    });
    render(<AgentOutputPanel processes={[]} output={line} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("re-expands the panel when a new active process appears after being collapsed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(<AgentOutputPanel processes={[]} output="old output" />);

    const header = screen.getByText("Agent Output (completed)").closest("button")!;
    await user.click(header);
    expect(screen.queryByText("old output")).toBeNull();

    rerender(
      <AgentOutputPanel processes={[makeProcess({ stage: "Implementing" })]} output="old output" />,
    );

    expect(screen.getByText("old output")).toBeDefined();
  });

  it("renders the elapsed timer text for the active process", () => {
    vi.setSystemTime(new Date("2024-01-01T00:01:05Z"));
    render(
      <AgentOutputPanel
        processes={[makeProcess({ startedAt: "2024-01-01T00:00:00Z" })]}
        output=""
      />,
    );
    // mins > 0 branch: "1m 5s"
    expect(screen.getByText("1m 5s")).toBeDefined();
  });

  it("renders the elapsed timer in seconds-only form when under a minute", () => {
    vi.setSystemTime(new Date("2024-01-01T00:00:10Z"));
    render(
      <AgentOutputPanel
        processes={[makeProcess({ startedAt: "2024-01-01T00:00:00Z" })]}
        output=""
      />,
    );
    expect(screen.getByText("10s")).toBeDefined();
  });

  it("renders an 'error' block type with the error text styling", () => {
    mockParse.mockReturnValueOnce([{ type: "error", content: "Fatal failure occurred" }]);
    render(<AgentOutputPanel processes={[]} output="anything" />);
    expect(screen.getByText("Fatal failure occurred")).toBeDefined();
  });

  it("renders a non-error tool_result block without the Error label", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: "all good", is_error: false }],
    });
    render(<AgentOutputPanel processes={[]} output={line} />);
    expect(screen.queryByText("Error")).toBeNull();
    expect(screen.getByText("all good")).toBeDefined();
  });
});
