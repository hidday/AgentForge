import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ActiveProcess } from "@/api/client.ts";

// Pass through to the real parser by default; individual tests can override
// the result to exercise block types the parser does not currently emit.
vi.mock("@/lib/parseClaudeOutput.ts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/parseClaudeOutput.ts")>(
    "@/lib/parseClaudeOutput.ts",
  );
  return { ...actual, parseClaudeOutput: vi.fn(actual.parseClaudeOutput) };
});

import { parseClaudeOutput } from "@/lib/parseClaudeOutput.ts";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";

const NOW = new Date("2026-01-10T12:00:00Z").getTime();

function proc(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 1,
    command: "claude",
    runId: "r1",
    stage: "planning",
    runtime: "claude-code",
    startedAt: new Date(NOW - 5_000).toISOString(),
    elapsedMs: 0,
    ...overrides,
  };
}

const line = (o: unknown) => JSON.stringify(o);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("AgentOutputPanel", () => {
  it("renders nothing with no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.innerHTML).toBe("");
  });

  it("shows runtime/stage header and a ticking elapsed timer while active", () => {
    render(<AgentOutputPanel processes={[proc()]} output="" />);
    expect(screen.getByText("claude-code")).toBeTruthy();
    expect(screen.getByText("planning")).toBeTruthy();
    expect(screen.getByText("5s")).toBeTruthy();
    expect(screen.getByText("Waiting for output...")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("1m 5s")).toBeTruthy();
  });

  it("shows a completed header when there is output but no process", () => {
    render(<AgentOutputPanel processes={[]} output="plain line" />);
    expect(screen.getByText("Agent Output (completed)")).toBeTruthy();
    // non-JSON line renders as a raw block
    expect(screen.getByText("plain line")).toBeTruthy();
  });

  it("renders parsed text, tool use and tool results", () => {
    const output = [
      line({ content: [{ type: "text", text: "Thinking about it" }] }),
      line({ content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }] }),
      line({ content: [{ type: "tool_result", content: "file.txt", is_error: false }] }),
      line({ content: [{ type: "tool_result", content: "boom", is_error: true }] }),
    ].join("\n");
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Thinking about it")).toBeTruthy();
    expect(screen.getByText("Bash")).toBeTruthy();
    expect(screen.getByText("ls -la")).toBeTruthy();
    expect(screen.getByText("file.txt").className).toContain("text-emerald-300/70");
    expect(screen.getByText("boom").className).toContain("text-red-300/80");
    expect(screen.getAllByText("Error")).toHaveLength(1);
  });

  it("toggles tool_use input visibility", () => {
    const output = line({ content: [{ type: "tool_use", name: "Read", input: { file_path: "/a.ts" } }] });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("/a.ts")).toBeTruthy();
    fireEvent.click(screen.getByText("Read"));
    expect(screen.queryByText("/a.ts")).toBeNull();
    fireEvent.click(screen.getByText("Read"));
    expect(screen.getByText("/a.ts")).toBeTruthy();
  });

  it("renders error blocks", () => {
    vi.mocked(parseClaudeOutput).mockReturnValueOnce([{ type: "error", content: "fatal: crashed" }]);
    render(<AgentOutputPanel processes={[]} output="anything" />);
    expect(screen.getByText("fatal: crashed").parentElement!.className).toContain("text-red-400");
  });

  it("switches between parsed and raw views", () => {
    const output = line({ content: [{ type: "text", text: "hello" }] });
    render(<AgentOutputPanel processes={[]} output={output} />);
    fireEvent.click(screen.getByText("raw"));
    expect(screen.getByText(output).tagName).toBe("PRE");
    fireEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("hello")).toBeTruthy();
  });

  it("shows waiting placeholder in raw view when active with no output", () => {
    render(<AgentOutputPanel processes={[proc()]} output="" />);
    fireEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...").tagName).toBe("PRE");
  });

  it("collapses and expands the body via the header", () => {
    render(<AgentOutputPanel processes={[]} output="some text" />);
    fireEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("some text")).toBeNull();
    expect(screen.queryByText("raw")).toBeNull();
    fireEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.getByText("some text")).toBeTruthy();
  });

  it("re-expands automatically when a new process becomes active", () => {
    const { rerender } = render(<AgentOutputPanel processes={[]} output="old output" />);
    fireEvent.click(screen.getByText("Agent Output (completed)"));
    expect(screen.queryByText("old output")).toBeNull();
    rerender(<AgentOutputPanel processes={[proc()]} output="old output" />);
    expect(screen.getByText("old output")).toBeTruthy();
  });

  it("scrolls to the bottom as output grows", () => {
    const { rerender, container } = render(<AgentOutputPanel processes={[]} output="a" />);
    const scroller = container.querySelector(".overflow-auto") as HTMLDivElement;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 500 });
    rerender(<AgentOutputPanel processes={[]} output={"a\nb"} />);
    expect(scroller.scrollTop).toBe(500);
  });
});
