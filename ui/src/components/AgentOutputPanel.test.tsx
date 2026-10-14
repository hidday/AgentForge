import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";

// Wrap the real parser with a spy so every existing test below still
// exercises genuine parsing logic; only the dedicated "error block" test
// overrides its return value, since the real parser never actually
// produces a "error"-typed block today (it's a defensive renderer branch).
vi.mock("@/lib/parseClaudeOutput.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/parseClaudeOutput.ts")>();
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

function ndjson(...events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n");
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

  it("shows the completed header when there is output but no active process", () => {
    render(<AgentOutputPanel processes={[]} output="some leftover output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows active process runtime/stage and an elapsed timer when a process is active", () => {
    const proc = makeProcess({ runtime: "claude-code", stage: "Implementing" });
    render(<AgentOutputPanel processes={[proc]} output="" />);

    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText(/^0s$/)).toBeDefined();
  });

  it("updates the elapsed timer as time passes", async () => {
    const startedAt = new Date().toISOString();
    const proc = makeProcess({ startedAt });
    render(<AgentOutputPanel processes={[proc]} output="" />);

    expect(screen.getByText(/^0s$/)).toBeDefined();

    await vi.advanceTimersByTimeAsync(5000);

    expect(screen.getByText(/^5s$/)).toBeDefined();
  });

  it("formats elapsed time in minutes and seconds once over a minute", async () => {
    const startedAt = new Date().toISOString();
    const proc = makeProcess({ startedAt });
    render(<AgentOutputPanel processes={[proc]} output="" />);

    await vi.advanceTimersByTimeAsync(65_000);

    expect(screen.getByText("1m 5s")).toBeDefined();
  });

  it("collapses and expands the panel when the header is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AgentOutputPanel processes={[]} output="some output" />);

    // Initially expanded: the raw/parsed toggle is visible
    expect(screen.getByRole("button", { name: "raw" })).toBeDefined();

    await user.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByRole("button", { name: "raw" })).toBeNull();

    await user.click(screen.getByText("Agent Output (completed)"));
    expect(screen.getByRole("button", { name: "raw" })).toBeDefined();
  });

  it("auto-expands when a process transitions from inactive to active", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(<AgentOutputPanel processes={[]} output="old output" />);

    await user.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByRole("button", { name: "raw" })).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output="old output" />);

    expect(screen.getByRole("button", { name: "raw" })).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const output = ndjson({ content: [{ type: "text", text: "Hello world" }] });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Hello world")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "raw" }));
    expect(screen.getByRole("button", { name: "parsed" })).toBeDefined();
    expect(screen.getByText(output)).toBeDefined();

    await user.click(screen.getByRole("button", { name: "parsed" }));
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("shows 'Waiting for output...' in the parsed view when there are no blocks", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("shows 'Waiting for output...' in the raw view when output is empty", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);

    await user.click(screen.getByRole("button", { name: "raw" }));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders a text block with a message icon", () => {
    const output = ndjson({ content: [{ type: "text", text: "Agent reply text" }] });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Agent reply text")).toBeDefined();
  });

  it("renders a tool_use block showing the tool name and formatted input, and toggles expand/collapse", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const output = ndjson({
      content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
    });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    // Expanded by default — clicking the tool name button collapses its content
    await user.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await user.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a non-error tool_result block without the Error label", () => {
    const output = ndjson({
      content: [{ type: "tool_result", content: "output body", is_error: false }],
    });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("output body")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders an error tool_result block with the Error label", () => {
    const output = ndjson({
      content: [{ type: "tool_result", content: "boom", is_error: true }],
    });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("renders unrecognized non-JSON lines as raw fallback blocks", () => {
    const output = "this is not json and not noise";
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("this is not json and not noise")).toBeDefined();
  });

  it("renders multiple active processes using only the first one for the header", () => {
    const procA = makeProcess({ id: "p1", runtime: "runtime-a", stage: "stage-a" });
    const procB = makeProcess({ id: "p2", runtime: "runtime-b", stage: "stage-b" });
    render(<AgentOutputPanel processes={[procA, procB]} output="" />);

    expect(screen.getByText("runtime-a")).toBeDefined();
    expect(screen.queryByText("runtime-b")).toBeNull();
  });

  it("renders an 'error'-typed block with the warning icon (defensive branch the real parser never emits)", () => {
    mockParse.mockReturnValueOnce([{ type: "error", content: "fatal failure" }]);
    render(<AgentOutputPanel processes={[]} output="irrelevant" />);
    expect(screen.getByText("fatal failure")).toBeDefined();
  });
});
