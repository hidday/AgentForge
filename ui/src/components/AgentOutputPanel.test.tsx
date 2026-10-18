import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentOutputPanel } from "./AgentOutputPanel.tsx";
import type { ActiveProcess } from "@/api/client.ts";

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

const textDeltaLine = JSON.stringify({
  type: "content_block_delta",
  delta: { type: "text_delta", text: "Hello from the agent" },
});

const toolUseLine = JSON.stringify({
  type: "content_block_start",
  content_block: { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
});

const toolResultErrorLine = JSON.stringify({
  tool_use_result: "Error: command failed",
});

describe("AgentOutputPanel", () => {
  it("renders nothing when there is no output and no active process", () => {
    const { container } = render(<AgentOutputPanel processes={[]} output="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the active-process header with runtime and stage when a process is running", () => {
    render(
      <AgentOutputPanel
        processes={[makeProcess({ runtime: "claude-code", stage: "Implementing" })]}
        output=""
      />,
    );
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("shows the completed header label when output exists but no process is active", () => {
    render(<AgentOutputPanel processes={[]} output={textDeltaLine} />);
    expect(screen.getByText("Agent Output (completed)")).toBeDefined();
  });

  it("shows a waiting message when a process is active but there is no output yet", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    expect(screen.getByText("Waiting for output...")).toBeDefined();
  });

  it("parses and renders a text block from NDJSON output", () => {
    render(<AgentOutputPanel processes={[]} output={textDeltaLine} />);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("collapses and re-expands the body when the header is clicked", async () => {
    render(<AgentOutputPanel processes={[]} output={textDeltaLine} />);
    expect(screen.getByText("Hello from the agent")).toBeDefined();

    const header = screen.getByRole("button", { name: /agent output \(completed\)/i });
    await userEvent.click(header);
    expect(screen.queryByText("Hello from the agent")).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("toggles between parsed and raw views", async () => {
    render(<AgentOutputPanel processes={[]} output={textDeltaLine} />);

    // Parsed view by default: the raw NDJSON is not shown verbatim.
    expect(screen.queryByText(textDeltaLine)).toBeNull();
    expect(screen.getByText("Hello from the agent")).toBeDefined();

    const rawToggle = screen.getByRole("button", { name: "raw" });
    await userEvent.click(rawToggle);

    // Raw view shows the exact NDJSON string and hides the parsed block UI.
    expect(screen.getByText(textDeltaLine)).toBeDefined();
    expect(screen.queryByText("Hello from the agent")).toBeNull();

    const parsedToggle = screen.getByRole("button", { name: "parsed" });
    await userEvent.click(parsedToggle);
    expect(screen.getByText("Hello from the agent")).toBeDefined();
  });

  it("renders a tool_use block with its tool name and expandable input, toggling on click", async () => {
    render(<AgentOutputPanel processes={[]} output={toolUseLine} />);

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("ls -la")).toBeDefined();

    const toolToggle = screen.getByText("Bash").closest("button") as HTMLButtonElement;
    await userEvent.click(toolToggle);
    expect(screen.queryByText("ls -la")).toBeNull();

    await userEvent.click(toolToggle);
    expect(screen.getByText("ls -la")).toBeDefined();
  });

  it("renders a tool_result error block with an Error label", () => {
    render(<AgentOutputPanel processes={[]} output={toolResultErrorLine} />);
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Error: command failed")).toBeDefined();
  });

  it("renders raw non-JSON lines verbatim as fallback blocks", () => {
    render(<AgentOutputPanel processes={[]} output="plain unstructured line" />);
    expect(screen.getByText("plain unstructured line")).toBeDefined();
  });

  it("shows the raw output textarea content even while waiting, when toggled to raw with empty output", () => {
    render(<AgentOutputPanel processes={[makeProcess()]} output="" />);
    const rawToggle = screen.getByRole("button", { name: "raw" });
    expect(rawToggle).toBeDefined();
  });
});
