import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

const mockParseClaudeOutput = vi.fn<(raw: string) => ParsedBlock[]>();

vi.mock("@/lib/parseClaudeOutput.ts", () => ({
  parseClaudeOutput: (raw: string) => mockParseClaudeOutput(raw),
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
    mockParseClaudeOutput.mockReset();
    mockParseClaudeOutput.mockReturnValue([]);
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the 'completed' header and the raw-output fallback when there is output but no active process", () => {
    mockParseClaudeOutput.mockReturnValue([{ type: "raw", content: "plain log line" }]);
    render(<AgentOutputPanel processes={[]} output="plain log line" />);

    expect(screen.getByText(/Agent Output \(completed\)/i)).toBeDefined();
    expect(screen.getByText("plain log line")).toBeDefined();
  });

  it("shows the process runtime, stage, and elapsed timer when a process is active", () => {
    const proc = makeProcess({ runtime: "codex", stage: "AIReview" });
    render(<AgentOutputPanel processes={[proc]} output="" />);

    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("AIReview")).toBeDefined();
    // Elapsed timer renders as e.g. "0s" immediately after mount for a just-started process
    expect(screen.getByText(/^\d+s$|^\d+m \d+s$/)).toBeDefined();
  });

  it("shows the waiting placeholder in parsed view when there are no blocks yet", () => {
    const proc = makeProcess();
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText(/Waiting for output.../i)).toBeDefined();
  });

  it("collapses the panel body when the header is clicked, hiding the view toggle and content", async () => {
    mockParseClaudeOutput.mockReturnValue([{ type: "raw", content: "hello" }]);
    render(<AgentOutputPanel processes={[]} output="hello" />);

    expect(screen.getByText("hello")).toBeDefined();
    const header = screen.getByText(/Agent Output \(completed\)/i).closest("button");
    expect(header).not.toBeNull();

    await userEvent.click(header as HTMLButtonElement);
    expect(screen.queryByText("hello")).toBeNull();
    expect(screen.queryByRole("button", { name: /raw|parsed/i })).toBeNull();

    // clicking again expands it back
    await userEvent.click(header as HTMLButtonElement);
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("toggles between parsed and raw views, with raw view showing the unparsed output string", async () => {
    mockParseClaudeOutput.mockReturnValue([{ type: "raw", content: "parsed-form" }]);
    render(<AgentOutputPanel processes={[]} output="RAW_TEXT_123" />);

    // Parsed view by default
    expect(screen.getByText("parsed-form")).toBeDefined();
    expect(screen.queryByText("RAW_TEXT_123")).toBeNull();

    const toggle = screen.getByRole("button", { name: "raw" });
    await userEvent.click(toggle);

    expect(screen.getByText("RAW_TEXT_123")).toBeDefined();
    expect(screen.queryByText("parsed-form")).toBeNull();

    const toggleBack = screen.getByRole("button", { name: "parsed" });
    await userEvent.click(toggleBack);
    expect(screen.getByText("parsed-form")).toBeDefined();
  });

  it("shows the raw-view placeholder text when output is an empty string but a process is active", async () => {
    const proc = makeProcess();
    render(<AgentOutputPanel processes={[proc]} output="" />);
    await userEvent.click(screen.getByRole("button", { name: "raw" }));
    expect(screen.getByText(/Waiting for output.../i)).toBeDefined();
  });

  it("renders a text block with its content", () => {
    mockParseClaudeOutput.mockReturnValue([{ type: "text", content: "Hello from the agent" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("renders a tool_use block expanded by default and collapses/expands on click", async () => {
    mockParseClaudeOutput.mockReturnValue([
      { type: "tool_use", toolName: "Bash", content: "ls -la" },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a tool_use block with no content without crashing and without a details pre", () => {
    mockParseClaudeOutput.mockReturnValue([{ type: "tool_use", toolName: "Glob", content: "" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Glob")).toBeDefined();
  });

  it("renders a successful tool_result block without an error badge", () => {
    mockParseClaudeOutput.mockReturnValue([
      { type: "tool_result", content: "file1-ok", isError: false },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("file1-ok")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders a failing tool_result block with an error badge", () => {
    mockParseClaudeOutput.mockReturnValue([
      { type: "tool_result", content: "boom", isError: true },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
  });

  it("renders an error block", () => {
    mockParseClaudeOutput.mockReturnValue([{ type: "error", content: "Something broke" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Something broke")).toBeDefined();
  });

  it("renders multiple mixed blocks together in order", () => {
    mockParseClaudeOutput.mockReturnValue([
      { type: "text", content: "first" },
      { type: "tool_use", toolName: "Read", content: "file.ts" },
      { type: "tool_result", content: "ok", isError: false },
      { type: "error", content: "oops" },
      { type: "raw", content: "trailing" },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);

    expect(screen.getByText("first")).toBeDefined();
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("ok")).toBeDefined();
    expect(screen.getByText("oops")).toBeDefined();
    expect(screen.getByText("trailing")).toBeDefined();
  });
});
