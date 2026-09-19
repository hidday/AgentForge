import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
    pid: 1234,
    command: "claude",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: new Date(Date.now() - 65_000).toISOString(),
    elapsedMs: 65_000,
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

  it("renders the completed label when there is output but no active process", () => {
    mockParse.mockReturnValue([{ type: "text", content: "done" }]);
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders active process metadata: runtime, stage, and elapsed timer", () => {
    render(
      <AgentOutputPanel processes={[makeProcess({ runtime: "codex", stage: "AIReview" })]} output="" />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("AIReview")).toBeDefined();
    // Elapsed should show minutes since startedAt was ~65s ago.
    expect(screen.getByText(/1m \d+s/)).toBeDefined();
  });

  it("shows seconds-only format when elapsed is under a minute", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ startedAt: new Date(Date.now() - 5_000).toISOString() })]}
        output=""
      />,
    );
    expect(screen.getByText(/^\d+s$/)).toBeDefined();
  });

  it("collapses and expands the panel when the header is clicked", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "hello" }]);
    render(<AgentOutputPanel processes={[]} output="hello" />);

    expect(screen.getByText("hello")).toBeDefined();
    const header = screen.getByText("Agent Output (completed)").closest("button")!;
    await userEvent.click(header);
    expect(screen.queryByText("hello")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "parsed text" }]);
    render(<AgentOutputPanel processes={[]} output="raw-output-content" />);

    expect(screen.getByText("parsed text")).toBeDefined();
    expect(screen.queryByText("raw-output-content")).toBeNull();

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("raw-output-content")).toBeDefined();
    expect(screen.queryByText("parsed text")).toBeNull();

    await userEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("parsed text")).toBeDefined();
  });

  it("shows a waiting placeholder in raw view when output is empty", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("shows a waiting placeholder in parsed view when there are no blocks", () => {
    mockParse.mockReturnValue([]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders a text block", () => {
    mockParse.mockReturnValue([{ type: "text", content: "Some agent text" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Some agent text")).toBeDefined();
  });

  it("renders a tool_use block and toggles its expanded detail", async () => {
    mockParse.mockReturnValue([
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

  it("renders a tool_use block with no content without crashing", () => {
    mockParse.mockReturnValue([{ type: "tool_use", toolName: "Read", content: "" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Read")).toBeDefined();
  });

  it("renders a successful tool_result block without an error label", () => {
    mockParse.mockReturnValue([
      { type: "tool_result", content: "ok output", isError: false },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("ok output")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders a failing tool_result block with an error label", () => {
    mockParse.mockReturnValue([
      { type: "tool_result", content: "boom", isError: true },
    ]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("renders an error block", () => {
    mockParse.mockReturnValue([{ type: "error", content: "Fatal failure" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("Fatal failure")).toBeDefined();
  });

  it("renders a raw/unknown block type via the fallback renderer", () => {
    mockParse.mockReturnValue([{ type: "raw", content: "unparsed line" }]);
    render(<AgentOutputPanel processes={[]} output="x" />);
    expect(screen.getByText("unparsed line")).toBeDefined();
  });

  it("auto-expands when a process transitions from inactive to active", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "finished output" }]);
    const { rerender } = render(<AgentOutputPanel processes={[]} output="finished output" />);

    const header = screen.getByText("Agent Output (completed)").closest("button")!;
    await userEvent.click(header);
    expect(screen.queryByText("finished output")).toBeNull();

    // A new active process arrives — panel should auto re-expand.
    rerender(<AgentOutputPanel processes={[makeProcess()]} output="finished output" />);

    expect(await screen.findByText("finished output")).toBeDefined();
  });
});
