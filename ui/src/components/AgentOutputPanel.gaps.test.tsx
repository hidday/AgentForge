import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ActiveProcess } from "@/api/client.ts";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "claude",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    elapsedMs: 1000,
    ...overrides,
  };
}

describe("AgentOutputPanel gaps", () => {
  it("renders a plain 'raw' block (non-JSON, non-noise line) using the default renderer branch", () => {
    // A plain text line that isn't valid JSON and doesn't match the noise
    // filters in parseClaudeOutput becomes a `{ type: "raw" }` block, which
    // falls through BlockRenderer's final default branch (dimmed text, no
    // icon) rather than the text/tool_use/tool_result/error branches.
    render(<AgentOutputPanel processes={[]} output="Processing files..." />);
    expect(screen.getByText("Processing files...")).toBeDefined();
  });

  it("formats the elapsed timer as 'Xm Ys' once a process has been running for over a minute", async () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString(); // 1m30s ago
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);

    expect(await screen.findByText(/^\d+m \d+s$/)).toBeDefined();
  });
});
