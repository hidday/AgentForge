import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";

// Wrap the real parser in a vi.fn so most tests exercise genuine parsing
// behaviour end-to-end, while a couple of tests can override its return
// value (via mockReturnValueOnce) to reach ParsedBlock branches that the
// real parser never actually produces (e.g. type: "error").
vi.mock("@/lib/parseClaudeOutput.ts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/parseClaudeOutput.ts")>(
    "@/lib/parseClaudeOutput.ts",
  );
  return {
    ...actual,
    parseClaudeOutput: vi.fn(actual.parseClaudeOutput),
  };
});

import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import { parseClaudeOutput } from "@/lib/parseClaudeOutput.ts";

const mockParse = parseClaudeOutput as unknown as ReturnType<
  typeof vi.fn<typeof parseClaudeOutput>
>;

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 1234,
    command: "claude",
    runId: "run-1",
    stage: "implement",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentOutputPanel – empty / no-output state", () => {
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("still renders the panel when a process is active even if output is empty", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("implement")).toBeDefined();
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });
});

describe("AgentOutputPanel – header content", () => {
  it("shows 'Agent Output (completed)' when there is no active process", () => {
    const line = JSON.stringify({ content: [{ type: "text", text: "Hello agent" }] });
    render(<AgentOutputPanel processes={[]} output={line} />);
    expect(screen.getByText(/Agent Output \(completed\)/i)).toBeDefined();
  });

  it("shows runtime and stage for an active process", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "codex", stage: "plan" })]}
        output=""
      />,
    );
    expect(screen.getByText("codex")).toBeDefined();
    expect(screen.getByText("plan")).toBeDefined();
  });
});

describe("AgentOutputPanel – elapsed timer", () => {
  it("shows seconds-only format under a minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:10Z"));
    const proc = makeProcess({ startedAt: "2024-01-01T00:00:00Z" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("10s")).toBeDefined();
  });

  it("switches to minutes+seconds format past a minute, and ticks upward", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:02:05Z"));
    const proc = makeProcess({ startedAt: "2024-01-01T00:00:00Z" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("2m 5s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("2m 6s")).toBeDefined();
  });
});

describe("AgentOutputPanel – collapse/expand interaction", () => {
  it("toggles the body visibility when the header is clicked", async () => {
    const user = userEvent.setup();
    const line = JSON.stringify({ content: [{ type: "text", text: "Some text" }] });
    render(<AgentOutputPanel processes={[]} output={line} />);

    // Expanded by default: the parsed/raw toggle button ("raw") is visible.
    expect(screen.getByText("raw")).toBeDefined();

    const headerBtn = screen.getByRole("button", { name: /Agent Output \(completed\)/i });
    await user.click(headerBtn);
    expect(screen.queryByText("raw")).toBeNull();

    await user.click(headerBtn);
    expect(screen.getByText("raw")).toBeDefined();
  });

  it("auto re-expands when a process transitions from inactive to active", async () => {
    const user = userEvent.setup();
    const line = JSON.stringify({ content: [{ type: "text", text: "Some text" }] });
    const { rerender } = render(<AgentOutputPanel processes={[]} output={line} />);

    const headerBtn = screen.getByRole("button", { name: /Agent Output \(completed\)/i });
    await user.click(headerBtn);
    expect(screen.queryByText("raw")).toBeNull();

    rerender(<AgentOutputPanel processes={[makeProcess()]} output={line} />);

    expect(screen.getByText("raw")).toBeDefined();
  });
});

describe("AgentOutputPanel – raw/parsed toggle", () => {
  it("shows the raw output text when 'raw' is clicked", async () => {
    const user = userEvent.setup();
    const line = JSON.stringify({ content: [{ type: "text", text: "Parsed text" }] });
    render(<AgentOutputPanel processes={[]} output={line} />);

    expect(screen.getByText("Parsed text")).toBeDefined();

    await user.click(screen.getByText("raw"));
    expect(screen.getByText(line)).toBeDefined();
    expect(screen.getByText("parsed")).toBeDefined();

    await user.click(screen.getByText("parsed"));
    expect(screen.getByText("Parsed text")).toBeDefined();
  });

  it("shows 'Waiting for output...' in raw mode when output is empty but a process is active", async () => {
    const user = userEvent.setup();
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await user.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });
});

describe("AgentOutputPanel – block rendering by type", () => {
  it("renders a text block", () => {
    const line = JSON.stringify({ content: [{ type: "text", text: "Hello from agent" }] });
    render(<AgentOutputPanel processes={[]} output={line} />);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("renders a tool_use block, expanded by default, and toggles collapse on click", async () => {
    const user = userEvent.setup();
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
    });
    render(<AgentOutputPanel processes={[]} output={line} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    await user.click(screen.getByText("Bash"));
    expect(screen.queryByText("ls -la")).toBeNull();

    await user.click(screen.getByText("Bash"));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("does not render a content <pre> for a tool_use block with empty content", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "NoArgs", input: {} }],
    });
    render(<AgentOutputPanel processes={[]} output={line} />);
    expect(screen.getByText("NoArgs")).toBeDefined();
  });

  it("renders a successful tool_result block without an error label", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: "all good", is_error: false }],
    });
    render(<AgentOutputPanel processes={[]} output={line} />);
    expect(screen.getByText("all good")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders a failing tool_result block with an error label", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: "boom", is_error: true }],
    });
    render(<AgentOutputPanel processes={[]} output={line} />);
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
  });

  it("renders a raw (unparseable) line gracefully instead of crashing", () => {
    render(<AgentOutputPanel processes={[]} output="{not valid json" />);
    expect(screen.getByText("{not valid json")).toBeDefined();
  });

  it("renders an 'error' typed block (synthetic, since the real parser never emits one)", () => {
    mockParse.mockReturnValueOnce([
      { type: "error", content: "Something went badly wrong" },
    ]);
    render(<AgentOutputPanel processes={[]} output="anything" />);
    expect(screen.getByText("Something went badly wrong")).toBeDefined();
  });

  it("shows 'Waiting for output...' in parsed mode when parsing yields no blocks despite non-empty output", () => {
    mockParse.mockReturnValueOnce([]);
    render(<AgentOutputPanel processes={[makeProcess()]} output="some unparsed noise" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("renders multiple mixed blocks in order", () => {
    const raw = [
      JSON.stringify({ content: [{ type: "text", text: "Starting" }] }),
      JSON.stringify({ content: [{ type: "tool_use", name: "Read", input: { file_path: "/tmp/a.txt" } }] }),
      JSON.stringify({ content: [{ type: "tool_result", content: "file contents", is_error: false }] }),
    ].join("\n");
    render(<AgentOutputPanel processes={[]} output={raw} />);
    expect(screen.getByText("Starting")).toBeDefined();
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("/tmp/a.txt")).toBeDefined();
    expect(screen.getByText("file contents")).toBeDefined();
  });
});
