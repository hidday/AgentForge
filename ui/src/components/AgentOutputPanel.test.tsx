import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

const parseClaudeOutputMock = vi.fn<(raw: string) => ParsedBlock[]>();

vi.mock("@/lib/parseClaudeOutput.ts", () => ({
  parseClaudeOutput: (raw: string) => parseClaudeOutputMock(raw),
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
    parseClaudeOutputMock.mockReset();
    parseClaudeOutputMock.mockReturnValue([]);
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the completed label when output exists but there is no active process", () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the active process's runtime and stage when a process is running", () => {
    render(<AgentOutputPanel processes={[makeProcess({ runtime: "codex", stage: "Planning" })]} output="" />);
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("toggles collapsed state when the header is clicked", async () => {
    parseClaudeOutputMock.mockReturnValue([{ type: "text", content: "hello" }]);
    render(<AgentOutputPanel processes={[]} output="hello" />);
    expect(screen.getByText("hello")).toBeDefined();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("hello")).toBeNull();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("shows a waiting placeholder when parsed blocks are empty", () => {
    parseClaudeOutputMock.mockReturnValue([]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders a text block's content", () => {
    parseClaudeOutputMock.mockReturnValue([{ type: "text", content: "Agent says hi" }]);
    render(<AgentOutputPanel processes={[]} output="raw" />);
    expect(screen.getByText("Agent says hi")).toBeDefined();
  });

  it("renders a tool_use block with its tool name and collapses/expands its content", async () => {
    parseClaudeOutputMock.mockReturnValue([
      { type: "tool_use", content: "ls -la", toolName: "Bash" },
    ]);
    render(<AgentOutputPanel processes={[]} output="raw" />);
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();
  });

  it("renders a failing tool_result block with the Error label and red styling", () => {
    parseClaudeOutputMock.mockReturnValue([
      { type: "tool_result", content: "boom", isError: true },
    ]);
    render(<AgentOutputPanel processes={[]} output="raw" />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("renders a successful tool_result block without the Error label", () => {
    parseClaudeOutputMock.mockReturnValue([
      { type: "tool_result", content: "ok", isError: false },
    ]);
    render(<AgentOutputPanel processes={[]} output="raw" />);
    expect(screen.queryByText("Error")).toBeNull();
    expect(screen.getByText("ok")).toBeDefined();
  });

  it("renders an error block", () => {
    parseClaudeOutputMock.mockReturnValue([{ type: "error", content: "Something broke" }]);
    render(<AgentOutputPanel processes={[]} output="raw" />);
    expect(screen.getByText("Something broke")).toBeDefined();
  });

  it("switches to raw mode and shows the unparsed output verbatim", async () => {
    parseClaudeOutputMock.mockReturnValue([{ type: "text", content: "parsed text" }]);
    render(<AgentOutputPanel processes={[]} output="the raw ndjson" />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("the raw ndjson")).toBeDefined();
    expect(screen.queryByText("parsed text")).toBeNull();
  });
});
