import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
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
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    ...overrides,
  };
}

// A real NDJSON line that parseClaudeOutput turns into a single text block.
const textOutput = JSON.stringify({ content: [{ type: "text", text: "Hello from agent" }] });

// A real NDJSON line that parses into a tool_use block.
const toolUseOutput = JSON.stringify({
  content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
});

// A real NDJSON line that parses into a successful tool_result block.
const toolResultOkOutput = JSON.stringify([
  { type: "tool_result", content: "file.txt", is_error: false },
]);

// A real NDJSON line that parses into an error tool_result block.
const toolResultErrOutput = JSON.stringify([
  { type: "tool_result", content: "boom", is_error: true },
]);

// A plain (non-JSON) line, which parseClaudeOutput emits as a "raw" block —
// this is the default/unknown-type fallback branch in BlockRenderer.
const rawOutput = "Processing files...";

// A noise fragment (matches parseClaudeOutput's metadata filter) that is not
// valid JSON and not meaningful text, so it produces zero blocks even though
// the raw `output` string itself is non-empty.
const noiseOnlyOutput =
  'xgBagQ=="}],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":6780,"output_tokens":8,"service_tier":"standard","inference_geo":"not_available"}}';

describe("AgentOutputPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there are no processes and no output", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the completed header when processes are empty but output is non-empty", () => {
    render(<AgentOutputPanel processes={[]} output={textOutput} />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("shows live process info (runtime/stage) when a process is active", () => {
    const proc = makeProcess({ runtime: "my-runtime", stage: "Planning" });
    const { container } = render(<AgentOutputPanel processes={[proc]} output="" />);

    expect(screen.getByText("my-runtime")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("shows 'Waiting for output...' in parsed view when blocks are empty but output is non-empty (active process)", () => {
    const proc = makeProcess();
    render(<AgentOutputPanel processes={[proc]} output={noiseOnlyOutput} />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("toggles collapsed state, hiding the body entirely", async () => {
    render(<AgentOutputPanel processes={[]} output={textOutput} />);

    expect(screen.getByText("Hello from agent")).toBeDefined();
    const toggle = screen.getByText("Agent Output (completed)").closest("button");
    expect(toggle).not.toBeNull();

    await userEvent.click(toggle as HTMLElement);
    expect(screen.queryByText("Hello from agent")).toBeNull();

    await userEvent.click(toggle as HTMLElement);
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    render(<AgentOutputPanel processes={[]} output={textOutput} />);

    // starts in parsed view: shows the parsed text, button offers "raw"
    expect(screen.getByText("Hello from agent")).toBeDefined();
    const rawToggle = screen.getByText("raw");
    await userEvent.click(rawToggle);

    // now in raw view: shows the raw JSON string, button now offers "parsed"
    expect(screen.getByText("parsed")).toBeDefined();
    expect(screen.queryByText("Hello from agent")).toBeNull();
    expect(screen.getByText(textOutput)).toBeDefined();

    await userEvent.click(screen.getByText("parsed"));
    expect(screen.getByText("Hello from agent")).toBeDefined();
  });

  it("raw view shows 'Waiting for output...' when output is empty but a process is active", async () => {
    const proc = makeProcess();
    render(<AgentOutputPanel processes={[proc]} output="" />);

    await userEvent.click(screen.getByText("raw"));
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  describe("BlockRenderer", () => {
    it("renders a text block", () => {
      render(<AgentOutputPanel processes={[]} output={textOutput} />);
      expect(screen.getByText("Hello from agent")).toBeDefined();
    });

    it("renders a tool_use block, expanded by default, collapsible via its own toggle", async () => {
      render(<AgentOutputPanel processes={[]} output={toolUseOutput} />);

      expect(screen.getByText("Bash")).toBeDefined();
      expect(screen.getByText("ls -la")).toBeDefined();

      const toolToggle = screen.getByText("Bash").closest("button");
      expect(toolToggle).not.toBeNull();
      await userEvent.click(toolToggle as HTMLElement);
      expect(screen.queryByText("ls -la")).toBeNull();

      await userEvent.click(toolToggle as HTMLElement);
      expect(screen.getByText("ls -la")).toBeDefined();
    });

    it("renders a successful tool_result block without error styling", () => {
      const { container } = render(<AgentOutputPanel processes={[]} output={toolResultOkOutput} />);
      expect(screen.getByText("file.txt")).toBeDefined();
      expect(screen.queryByText("Error")).toBeNull();
      expect(container.querySelector(".border-emerald-500\\/40")).not.toBeNull();
    });

    it("renders a failing tool_result block with error styling", () => {
      const { container } = render(<AgentOutputPanel processes={[]} output={toolResultErrOutput} />);
      expect(screen.getByText("boom")).toBeDefined();
      expect(screen.getByText("Error")).toBeDefined();
      expect(container.querySelector(".border-red-500\\/50")).not.toBeNull();
    });

    it("renders an unrecognised/raw block through the default fallback branch", () => {
      render(<AgentOutputPanel processes={[]} output={rawOutput} />);
      expect(screen.getByText(rawOutput)).toBeDefined();
    });
  });

  describe("ElapsedTimer", () => {
    it("shows seconds-only formatting before a minute has elapsed", () => {
      vi.useFakeTimers();
      const now = new Date("2026-01-01T00:00:00.000Z");
      vi.setSystemTime(now);

      const proc = makeProcess({ startedAt: now.toISOString() });
      render(<AgentOutputPanel processes={[proc]} output="" />);

      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(screen.getByText("5s")).toBeDefined();
    });

    it("formats elapsed time as minutes and seconds once a minute has passed", () => {
      vi.useFakeTimers();
      const now = new Date("2026-01-01T00:00:00.000Z");
      vi.setSystemTime(now);

      const proc = makeProcess({ startedAt: now.toISOString() });
      render(<AgentOutputPanel processes={[proc]} output="" />);

      act(() => {
        vi.advanceTimersByTime(65_000);
      });
      expect(screen.getByText("1m 5s")).toBeDefined();
    });
  });
});
