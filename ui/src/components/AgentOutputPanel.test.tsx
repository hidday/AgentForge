import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

vi.mock("@/lib/parseClaudeOutput.ts", () => ({
  parseClaudeOutput: vi.fn(),
}));

import { parseClaudeOutput } from "@/lib/parseClaudeOutput.ts";

const mockParse = parseClaudeOutput as unknown as ReturnType<typeof vi.fn>;

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "claude",
    runId: "run-1",
    stage: "planner",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  beforeEach(() => {
    mockParse.mockReturnValue([]);
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the completed label when there are no active processes but output exists", () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the runtime, stage, and elapsed timer for an active process", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "codex", stage: "reviewer" })]}
        output=""
      />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("reviewer")).toBeDefined();
  });

  it("toggles collapse state when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="hi" />);
    expect(screen.getByText("raw")).toBeDefined();

    await userEvent.click(screen.getByText("claude-code"));
    expect(screen.queryByText("raw")).toBeNull();

    await userEvent.click(screen.getByText("claude-code"));
    expect(screen.getByText("raw")).toBeDefined();
  });

  it("shows a waiting placeholder when there are no parsed blocks", () => {
    mockParse.mockReturnValue([]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders a text block", () => {
    const blocks: ParsedBlock[] = [{ type: "text", content: "Hello from the agent" }];
    mockParse.mockReturnValue(blocks);
    render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("renders a tool_use block and toggles its expanded detail", async () => {
    const blocks: ParsedBlock[] = [
      { type: "tool_use", content: "cat file.ts", toolName: "Bash" },
    ];
    mockParse.mockReturnValue(blocks);
    render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("cat file.ts")).toBeDefined();

    await userEvent.click(screen.getByText("Bash"));
    expect(screen.queryByText("cat file.ts")).toBeNull();
  });

  it("renders a successful tool_result block without the error label", () => {
    const blocks: ParsedBlock[] = [
      { type: "tool_result", content: "file contents", isError: false },
    ];
    mockParse.mockReturnValue(blocks);
    render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
    expect(screen.getByText("file contents")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders a failing tool_result block with the error label", () => {
    const blocks: ParsedBlock[] = [
      { type: "tool_result", content: "boom", isError: true },
    ];
    mockParse.mockReturnValue(blocks);
    render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("renders an error block", () => {
    const blocks: ParsedBlock[] = [{ type: "error", content: "fatal error" }];
    mockParse.mockReturnValue(blocks);
    render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
    expect(screen.getByText("fatal error")).toBeDefined();
  });

  it("renders a raw/unknown block via the fallback renderer", () => {
    const blocks: ParsedBlock[] = [{ type: "raw", content: "unparsed line" }];
    mockParse.mockReturnValue(blocks);
    render(<AgentOutputPanel processes={[makeProcess()]} output="x" />);
    expect(screen.getByText("unparsed line")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    mockParse.mockReturnValue([{ type: "text", content: "parsed text" }]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="raw output here" />);

    expect(screen.getByText("parsed text")).toBeDefined();

    await userEvent.click(screen.getByText("raw"));

    expect(screen.getByText("raw output here")).toBeDefined();
    expect(screen.getByText("parsed")).toBeDefined();
  });

  it("shows a waiting placeholder in raw view when output is empty", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });
});
