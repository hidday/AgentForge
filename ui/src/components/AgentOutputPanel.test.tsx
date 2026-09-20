import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 123,
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
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);

    expect(container.firstChild).toBeNull();
  });

  it("shows the completed header when output exists but no process is active", () => {
    render(<AgentOutputPanel processes={[]} output="some completed output" />);

    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows the runtime, stage, and elapsed timer for an active process", () => {
    const proc = makeProcess({ runtime: "claude-code", stage: "Implementing" });
    render(<AgentOutputPanel processes={[proc]} output="" />);

    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    // Elapsed since startedAt is ~65s -> rendered as "1m Xs"
    expect(screen.getByText(/^1m \d+s$/)).toBeDefined();
  });

  it("shows a waiting placeholder when there is no output yet but a process is active", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);

    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles collapsed state when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[]} output="hello output" />);

    // Expanded by default: raw/parsed toggle button visible
    expect(screen.getByText("raw")).toBeDefined();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("raw")).toBeNull();

    await userEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.getByText("raw")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    const output = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
    });

    render(<AgentOutputPanel processes={[]} output={output} />);

    // Parsed view shows the tool name
    expect(screen.getByText("Bash")).toBeDefined();

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("parsed")).toBeDefined();
    // Raw view dumps the untouched NDJSON text
    expect(screen.getByText(output)).toBeDefined();
  });

  it("renders parsed text and tool_use blocks, expanding/collapsing tool details on click", async () => {
    const lines = [
      JSON.stringify([{ type: "text", text: "Working on it." }]),
      JSON.stringify({
        type: "content_block_start",
        content_block: { type: "tool_use", name: "Read", input: { file_path: "src/a.ts" } },
      }),
    ].join("\n");

    render(<AgentOutputPanel processes={[]} output={lines} />);

    expect(screen.getByText("Working on it.")).toBeDefined();
    expect(screen.getByText("Read")).toBeDefined();
    // Expanded by default, so tool input content shows.
    expect(screen.getByText("src/a.ts")).toBeDefined();

    await userEvent.click(screen.getByText("Read"));
    expect(screen.queryByText("src/a.ts")).toBeNull();

    await userEvent.click(screen.getByText("Read"));
    expect(screen.getByText("src/a.ts")).toBeDefined();
  });

  it("renders an error tool_result block distinctly", () => {
    const output = JSON.stringify({ tool_use_result: "Error: file not found" });

    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Error: file not found")).toBeDefined();
  });
});
