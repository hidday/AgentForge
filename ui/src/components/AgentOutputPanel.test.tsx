import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 1,
    command: "npm test",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders 'Agent Output (completed)' header when there is output but no active process", () => {
    render(<AgentOutputPanel processes={[]} output="some past output" />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("renders the runtime/stage/timer header when a process is active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:05Z"));
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("claude")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("5s")).toBeDefined();
  });

  it("formats elapsed time in minutes and seconds once over a minute, and ticks forward", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:01:05Z"));
    render(
      <AgentOutputPanel
        processes={[makeProcess({ startedAt: "2024-01-01T00:00:00Z" })]}
        output=""
      />,
    );
    expect(screen.getByText("1m 5s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("1m 7s")).toBeDefined();
  });

  it("toggles collapsed state when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[]} output="some output" />);
    expect(screen.getByText("some output")).toBeDefined();

    const header = screen.getByRole("button", { name: /Agent Output/i });
    await userEvent.click(header);
    expect(screen.queryByText("some output")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("some output")).toBeDefined();
  });

  it("shows a waiting placeholder in parsed view when output produces no blocks", () => {
    render(<AgentOutputPanel processes={[]} output="   " />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles between parsed and raw output views", async () => {
    const output = JSON.stringify({ content: [{ type: "text", text: "Hello agent" }] });
    render(<AgentOutputPanel processes={[]} output={output} />);

    // Parsed view renders the text block content
    expect(screen.getByText("Hello agent")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "raw" }));
    // Raw view renders the raw JSON string; parsed content should be gone.
    expect(screen.getByText("parsed")).toBeDefined();
    expect(screen.getByText(output)).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "parsed" }));
    expect(screen.getByText("Hello agent")).toBeDefined();
  });

  it("shows a 'Waiting for output...' placeholder in raw view when output is empty", async () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await userEvent.click(screen.getByRole("button", { name: "raw" }));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders a tool_use block and toggles its expanded input on click", async () => {
    const output = JSON.stringify({
      content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
    });
    render(<AgentOutputPanel processes={[]} output={output} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /Bash/i }));
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Bash/i }));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a successful tool_result block without an error marker", () => {
    const output = JSON.stringify({ tool_use_result: "build succeeded" });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("build succeeded")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders a failing tool_result block with an error marker", () => {
    const output = JSON.stringify({ tool_use_result: "Error: build failed" });
    render(<AgentOutputPanel processes={[]} output={output} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Error: build failed")).toBeDefined();
  });

  it("renders a raw (non-JSON) block using the default renderer", () => {
    render(<AgentOutputPanel processes={[]} output="Just plain text output" />);
    expect(screen.getByText("Just plain text output")).toBeDefined();
  });
});
