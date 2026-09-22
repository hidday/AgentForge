import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    elapsedMs: 0,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the completed header when there is output but no active process", () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders the active process header with runtime and stage when a process is active", () => {
    const proc = makeProcess({ runtime: "codex", stage: "AIReview" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("AIReview")).toBeDefined();
    expect(screen.queryByText("Agent Output (completed)")).toBeNull();
  });

  it("shows a waiting placeholder in the parsed view when there is no parseable output", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles collapsed state when the header is clicked, hiding the body", async () => {
    const { container } = render(
      <AgentOutputPanel processes={[makeProcess()]} output="" />,
    );
    expect(screen.getByText("Waiting for output...")).toBeDefined();

    const header = container.querySelector("button") as HTMLElement;
    await userEvent.click(header);

    expect(screen.queryByText("Waiting for output...")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    const output = "plain unparsed text line";
    render(<AgentOutputPanel processes={[]} output={output} />);

    // Default parsed view renders the raw fallback block for unparseable content
    expect(screen.getByText(output)).toBeDefined();

    await userEvent.click(screen.getByText("raw"));
    // Raw view shows a <pre> with the exact output text
    const pre = screen.getByText(output, { selector: "pre" });
    expect(pre).toBeDefined();

    await userEvent.click(screen.getByText("parsed"));
    expect(screen.queryByText(output, { selector: "pre" })).toBeNull();
  });

  it("shows a 'Waiting for output...' placeholder in the raw view when output is empty", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...", { selector: "pre" })).toBeDefined();
  });

  describe("elapsed timer", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows elapsed seconds and updates every second while a process is active", () => {
      const start = new Date("2024-01-01T00:00:00.000Z");
      vi.setSystemTime(start);
      const proc = makeProcess({ startedAt: start.toISOString() });
      render(<AgentOutputPanel processes={[proc]} output="" />);

      expect(screen.getByText("0s")).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(screen.getByText("5s")).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByText("1m 5s")).toBeDefined();
    });
  });

  describe("block rendering (via a mocked parser)", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("renders text, tool_use, tool_result (error and success), and unknown block types distinctly", async () => {
      vi.doMock("@/lib/parseClaudeOutput.ts", () => ({
        parseClaudeOutput: () => [
          { type: "text", content: "Hello from the agent" },
          { type: "tool_use", toolName: "Bash", content: "ls -la" },
          { type: "tool_result", content: "file1\nfile2", isError: false },
          { type: "tool_result", content: "boom", isError: true },
          { type: "error", content: "Something broke" },
          { type: "raw", content: "unrecognized line" },
        ],
      }));
      const { AgentOutputPanel: MockedPanel } = await import("./AgentOutputPanel.tsx");

      render(<MockedPanel processes={[]} output="irrelevant" />);

      expect(screen.getByText("Hello from the agent")).toBeDefined();
      expect(screen.getByText("Bash")).toBeDefined();
      expect(screen.getByText("ls -la")).toBeDefined();
      expect(screen.getByText("file1 file2")).toBeDefined();
      expect(screen.getByText("boom")).toBeDefined();
      expect(screen.getByText("Error")).toBeDefined();
      expect(screen.getByText("Something broke")).toBeDefined();
      expect(screen.getByText("unrecognized line")).toBeDefined();

      vi.doUnmock("@/lib/parseClaudeOutput.ts");
    });

    it("collapses a tool_use block's detail when its header is clicked", async () => {
      vi.doMock("@/lib/parseClaudeOutput.ts", () => ({
        parseClaudeOutput: () => [
          { type: "tool_use", toolName: "Read", content: "/etc/hosts" },
        ],
      }));
      const { AgentOutputPanel: MockedPanel } = await import("./AgentOutputPanel.tsx");

      render(<MockedPanel processes={[]} output="irrelevant" />);
      expect(screen.getByText("/etc/hosts")).toBeDefined();

      await userEvent.click(screen.getByText("Read"));
      expect(screen.queryByText("/etc/hosts")).toBeNull();

      await userEvent.click(screen.getByText("Read"));
      expect(screen.getByText("/etc/hosts")).toBeDefined();

      vi.doUnmock("@/lib/parseClaudeOutput.ts");
    });
  });
});
