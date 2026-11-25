import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

// Wrap the real parser so we can also inject a synthetic "error" block type,
// which the real NDJSON parser never emits but BlockRenderer still handles.
vi.mock("@/lib/parseClaudeOutput.ts", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/parseClaudeOutput.ts")>(
      "@/lib/parseClaudeOutput.ts",
    );
  return {
    ...actual,
    parseClaudeOutput: (raw: string) => {
      if (raw === "__ERROR_BLOCK__") {
        return [{ type: "error", content: "fatal failure" }];
      }
      return actual.parseClaudeOutput(raw);
    },
  };
});

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
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the completed label when output exists but no process is active", () => {
    render(<AgentOutputPanel processes={[]} output="some log line" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the active process runtime/stage and an elapsed timer when a process is running", async () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "claude-code", stage: "Implementing" })]}
        output=""
      />,
    );

    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("0s")).toBeDefined();

    await vi.advanceTimersByTimeAsync(65_000);
    expect(screen.getByText("1m 5s")).toBeDefined();
  });

  it("collapses and re-expands the panel when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[]} output="hello world" />);

    expect(screen.getByText("hello world")).toBeDefined();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("hello world")).toBeNull();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.getByText("hello world")).toBeDefined();
  });

  it("shows a waiting placeholder when a process is active but has produced no output yet", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    render(<AgentOutputPanel processes={[]} output="plain unparsed line" />);

    expect(screen.getByText("plain unparsed line")).toBeDefined();
    expect(screen.getByText("raw")).toBeDefined();

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("parsed")).toBeDefined();
    // Raw view renders the whole output string verbatim inside a <pre>.
    expect(screen.getByText("plain unparsed line", { selector: "pre" })).toBeDefined();
  });

  it("shows 'Waiting for output...' in the raw view when output is empty but a process is active", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders a tool_use block and toggles its expanded input", async () => {
    const output = JSON.stringify({
      content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
    });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a successful tool_result block without an error label", () => {
    const output = JSON.stringify({
      content: [{ type: "tool_result", content: "build succeeded", is_error: false }],
    });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("build succeeded")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders a failing tool_result block with an error label", () => {
    const output = JSON.stringify({
      content: [{ type: "tool_result", content: "boom: command failed", is_error: true }],
    });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom: command failed")).toBeDefined();
  });

  it("renders a text block", () => {
    const output = JSON.stringify({ content: [{ type: "text", text: "Working on it" }] });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Working on it")).toBeDefined();
  });

  it("renders an error-type block", () => {
    render(<AgentOutputPanel processes={[]} output="__ERROR_BLOCK__" />);
    expect(screen.getByText("fatal failure")).toBeDefined();
  });

  it("auto-expands the panel when a process transitions from inactive to active", async () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output="log" />);

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("Waiting for output...")).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output="log" />);

    expect(await screen.findByText(/parsed|raw/)).toBeDefined();
  });
});
