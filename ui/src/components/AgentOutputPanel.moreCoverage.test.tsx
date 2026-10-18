import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

// Mock the parser so we can inject a block type ("error") that the real
// parseClaudeOutput never produces, to exercise BlockRenderer's "error" case.
vi.mock("@/lib/parseClaudeOutput.ts", () => ({
  parseClaudeOutput: vi.fn((raw: string): ParsedBlock[] => {
    if (raw === "__ERROR_BLOCK__") {
      return [{ type: "error", content: "Something went wrong in the agent" }];
    }
    if (raw === "__SUCCESS_TOOL_RESULT__") {
      return [{ type: "tool_result", content: "all good", isError: false }];
    }
    return [];
  }),
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
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    ...overrides,
  };
}

describe("AgentOutputPanel – additional branch coverage", () => {
  it("renders an 'error' block with the AlertTriangle label and message", () => {
    render(<AgentOutputPanel processes={[]} output="__ERROR_BLOCK__" />);
    expect(screen.getByText("Something went wrong in the agent")).toBeDefined();
  });

  it("renders a non-error tool_result without the red 'Error' label", () => {
    render(<AgentOutputPanel processes={[]} output="__SUCCESS_TOOL_RESULT__" />);
    expect(screen.getByText("all good")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("shows minutes in the elapsed timer once over 60 seconds have passed", () => {
    const longAgo = new Date(Date.now() - 125_000).toISOString(); // 2m 5s ago
    render(<AgentOutputPanel processes={[makeProcess({ startedAt: longAgo })]} output="" />);
    expect(screen.getByText(/^\d+m \d+s$/)).toBeDefined();
  });

  it("shows the waiting placeholder in the raw view when output is empty", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);

    const rawToggle = screen.getByRole("button", { name: "raw" });
    await userEvent.click(rawToggle);

    const pres = document.querySelectorAll("pre");
    const rawPre = Array.from(pres).find((p) => p.textContent === "Waiting for output...");
    expect(rawPre).toBeDefined();
  });
});
