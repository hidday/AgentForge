import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActiveProcess } from "@/api/client.ts";
import type { ParsedBlock } from "@/lib/parseClaudeOutput.ts";

// The real parser never emits a `type: "error"` block (see
// src/lib/parseClaudeOutput.ts), but AgentOutputPanel's BlockRenderer still
// has a dedicated branch for it. Wrap the real module so most tests use
// genuine parsing, while one test can force an override to exercise that
// rendering branch directly.
let parseOverride: ParsedBlock[] | null = null;
vi.mock("@/lib/parseClaudeOutput.ts", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/parseClaudeOutput.ts")>(
      "@/lib/parseClaudeOutput.ts",
    );
  return {
    ...actual,
    parseClaudeOutput: (raw: string) =>
      parseOverride ?? actual.parseClaudeOutput(raw),
  };
});

import { AgentOutputPanel } from "./AgentOutputPanel.tsx";

afterEach(() => {
  parseOverride = null;
});

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 123,
    command: "claude",
    runId: "run-1",
    stage: "execution",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    ...overrides,
  };
}

describe("AgentOutputPanel", () => {
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the panel with 'Agent Output (completed)' label when output exists but no process is active", () => {
    render(<AgentOutputPanel processes={[]} output="some output text" />);
    expect(screen.getByText(/Agent Output \(completed\)/i)).toBeDefined();
  });

  it("renders the runtime/stage/elapsed header when a process is active", () => {
    const proc = makeProcess({ runtime: "claude-code", stage: "review" });
    render(<AgentOutputPanel processes={[proc]} output="" />);
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("review")).toBeDefined();
  });

  it("toggles collapsed state when the header button is clicked", async () => {
    const user = userEvent.setup();
    render(<AgentOutputPanel processes={[]} output="hello output" />);

    // Initially expanded: the parsed/raw toggle button is visible
    expect(screen.getByRole("button", { name: /^raw$/ })).toBeDefined();

    const headerBtn = screen.getByRole("button", { name: /Agent Output \(completed\)/i });
    await user.click(headerBtn);

    // Collapsed now: raw/parsed toggle should be gone
    expect(screen.queryByRole("button", { name: /^raw$/ })).toBeNull();

    await user.click(headerBtn);
    expect(screen.getByRole("button", { name: /^raw$/ })).toBeDefined();
  });

  it("shows 'Waiting for output...' placeholder text in parsed view when output produces no blocks", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText(/Waiting for output/i)).toBeDefined();
  });

  it("switches between parsed and raw views via the toggle button", async () => {
    const user = userEvent.setup();
    const raw = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello from agent" },
    });
    render(<AgentOutputPanel processes={[]} output={raw} />);

    // Parsed view shows the extracted text block
    expect(screen.getByText("Hello from agent")).toBeDefined();

    const toggleBtn = screen.getByRole("button", { name: /^raw$/ });
    await user.click(toggleBtn);

    // Raw view shows the raw NDJSON string and the button now reads "parsed"
    expect(screen.getByRole("button", { name: /^parsed$/ })).toBeDefined();
    expect(screen.getByText((_, node) => node?.textContent === raw)).toBeDefined();

    await user.click(screen.getByRole("button", { name: /^parsed$/ }));
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("shows the 'Waiting for output...' placeholder in raw view when output is empty", async () => {
    const user = userEvent.setup();
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    await user.click(screen.getByRole("button", { name: /^raw$/ }));
    expect(screen.getByText(/Waiting for output.../i)).toBeDefined();
  });

  it("renders a text block via the MessageSquare row", () => {
    const raw = JSON.stringify([{ type: "text", text: "Plain text block" }]);
    render(<AgentOutputPanel processes={[]} output={raw} />);
    expect(screen.getByText("Plain text block")).toBeDefined();
  });

  it("renders a tool_use block collapsed toggle showing its tool name and input, expanded by default", async () => {
    const user = userEvent.setup();
    const raw = JSON.stringify([
      { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
    ]);
    render(<AgentOutputPanel processes={[]} output={raw} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    // Clicking the tool_use header collapses its content
    await user.click(screen.getByRole("button", { name: /Bash/i }));
    expect(screen.queryByText("ls -la")).toBeNull();

    // Clicking again re-expands it
    await user.click(screen.getByRole("button", { name: /Bash/i }));
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a tool_use block with no content without crashing when input is empty", () => {
    const raw = JSON.stringify([{ type: "tool_use", name: "NoInputTool", input: {} }]);
    render(<AgentOutputPanel processes={[]} output={raw} />);
    expect(screen.getByText("NoInputTool")).toBeDefined();
  });

  it("renders a successful tool_result block without an error label", () => {
    const raw = JSON.stringify([
      { type: "tool_result", content: "Command succeeded", is_error: false },
    ]);
    render(<AgentOutputPanel processes={[]} output={raw} />);
    expect(screen.getByText("Command succeeded")).toBeDefined();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("renders an errored tool_result block with the Error label", () => {
    const raw = JSON.stringify([
      { type: "tool_result", content: "Boom", is_error: true },
    ]);
    render(<AgentOutputPanel processes={[]} output={raw} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Boom")).toBeDefined();
  });

  it("renders a tool_result whose tool_use_result string starts with 'Error:' as an errored tool_result", () => {
    const raw = JSON.stringify({ tool_use_result: "Error: file not found" });
    render(<AgentOutputPanel processes={[]} output={raw} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Error: file not found")).toBeDefined();
  });

  it("renders an 'error'-type block via the AlertTriangle row (BlockRenderer's error branch)", () => {
    parseOverride = [{ type: "error", content: "Fatal parser error" }];
    render(<AgentOutputPanel processes={[]} output="irrelevant raw text" />);
    expect(screen.getByText("Fatal parser error")).toBeDefined();
  });

  it("renders a raw fallback line as plain dimmed text", () => {
    const raw = "this is not json and not noise";
    render(<AgentOutputPanel processes={[]} output={raw} />);
    expect(screen.getByText("this is not json and not noise")).toBeDefined();
  });

  it("formats the elapsed timer as minutes and seconds once a process has run 60+ seconds", () => {
    const startedAt = new Date(Date.now() - 65_000).toISOString();
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText(/^1m \d+s$/)).toBeDefined();
  });

  it("formats the elapsed timer as plain seconds when under 60 seconds", () => {
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    render(<AgentOutputPanel processes={[makeProcess({ startedAt })]} output="" />);
    expect(screen.getByText(/^\d+s$/)).toBeDefined();
  });

  it("re-expands the collapsed panel automatically when a new active process appears", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AgentOutputPanel processes={[]} output="done output" />);

    const headerBtn = screen.getByRole("button", { name: /Agent Output \(completed\)/i });
    await user.click(headerBtn);
    expect(screen.queryByRole("button", { name: /^raw$/ })).toBeNull();

    // A new active process appears — panel should auto re-expand
    rerender(<AgentOutputPanel processes={[makeProcess()]} output="done output" />);

    expect(await screen.findByRole("button", { name: /^raw$/ })).toBeDefined();
  });
});
