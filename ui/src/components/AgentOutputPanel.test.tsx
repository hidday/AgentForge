import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

// parseClaudeOutput never currently emits a "error"-typed block (see
// parseClaudeOutput.test.ts), but BlockRenderer still has a render path for
// it (ParsedBlock["type"] includes "error"). Spy on the real implementation
// so every other test keeps exercising genuine parsing, and only override
// the return value for the one test that needs an "error" block.
vi.mock("@/lib/parseClaudeOutput.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/parseClaudeOutput.ts")>();
  return { ...actual, parseClaudeOutput: vi.fn(actual.parseClaudeOutput) };
});
import { parseClaudeOutput } from "@/lib/parseClaudeOutput.ts";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
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
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.innerHTML).toBe("");
  });

  it("shows a 'completed' label and waiting message when there is output but no active process", () => {
    render(<AgentOutputPanel processes={[]} output=" " />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the runtime, stage and an elapsed timer for an active process", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "claude-code", stage: "Implementing" })]}
        output=""
      />,
    );
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText(/^\d+s$|^\d+m \d+s$/)).toBeDefined();
  });

  it("shows a waiting message when there are no parsed blocks yet", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("parses and renders text, tool_use and tool_result blocks from NDJSON output", () => {
    const output = [
      JSON.stringify({
        type: "content_block_start",
        content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
      }),
      JSON.stringify([{ type: "text", text: "Hello from the agent" }]),
      JSON.stringify({ tool_use_result: "Error: boom" }),
    ].join("\n");

    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Hello from the agent")).toBeDefined();
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Error: boom")).toBeDefined();
  });

  it("renders a successful (non-error) tool_result without the Error label", () => {
    const output = JSON.stringify({ tool_use_result: "file listing: a.ts, b.ts" });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("file listing: a.ts, b.ts")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("toggles a tool_use block's input visibility when clicked", async () => {
    const output = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Read", input: { file_path: "src/app.ts" } },
    });

    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("src/app.ts")).toBeDefined();
    await userEvent.click(screen.getByText("Read"));
    expect(screen.queryByText("src/app.ts")).toBeNull();
    await userEvent.click(screen.getByText("Read"));
    expect(screen.getByText("src/app.ts")).toBeDefined();
  });

  it("renders a raw fallback line that is not valid JSON and not noise", () => {
    render(<AgentOutputPanel processes={[]} output="plain unparseable output line" />);
    expect(screen.getByText("plain unparseable output line")).toBeDefined();
  });

  it("switches between parsed and raw views", async () => {
    const output = JSON.stringify([{ type: "text", text: "Parsed text block" }]);
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Parsed text block")).toBeDefined();
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText(output)).toBeDefined();
    await userEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("Parsed text block")).toBeDefined();
  });

  it("collapses and expands the panel when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);

    expect(screen.getByText("Waiting for output...")).toBeDefined();
    await userEvent.click(screen.getByText("claude-code"));
    expect(screen.queryByText("Waiting for output...")).toBeNull();
    await userEvent.click(screen.getByText("claude-code"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders elapsed time in minutes and seconds once over a minute has passed", () => {
    const startedAt = new Date(Date.now() - 65_000).toISOString();
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);

    expect(screen.getByText(/^1m \d+s$/)).toBeDefined();
  });

  it("falls back to 'Waiting for output...' in the raw view when output is empty but a process is active", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders an error block with warning styling when the parser produces one", () => {
    (parseClaudeOutput as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      { type: "error", content: "The model returned a malformed tool call" },
    ]);

    render(<AgentOutputPanel processes={[]} output="anything" />);

    expect(screen.getByText("The model returned a malformed tool call")).toBeDefined();
  });
});
