// Supplementary ChatPanel coverage: collapsing, missing content, non-Error
// failures, submit guards and auto-scroll.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Artifact } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({ api: { sendChatMessage: vi.fn() } }));

import { api } from "@/api/client.ts";
import { ChatPanel } from "./ChatPanel.tsx";

const send = api.sendChatMessage as unknown as ReturnType<typeof vi.fn>;

function chat(id: string, payload: unknown, createdAt: string): Artifact {
  return { id, runId: "r1", type: "ChatMessage", version: 1, payloadJson: payload, rawText: "", createdAt };
}

const originalScroll = Element.prototype.scrollIntoView;

beforeEach(() => {
  send.mockReset();
});
afterEach(() => {
  Element.prototype.scrollIntoView = originalScroll;
});

describe("ChatPanel behavior", () => {
  it("collapses and expands the panel", () => {
    render(<ChatPanel runId="r1" artifacts={[]} />);
    expect(screen.getByPlaceholderText("Ask the agent about this run…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Chat with Agent/ }));
    expect(screen.queryByPlaceholderText("Ask the agent about this run…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Chat with Agent/ }));
    expect(screen.getByPlaceholderText("Ask the agent about this run…")).toBeTruthy();
  });

  it("treats non-assistant roles as user and missing content as empty, sorted by time", () => {
    const { container } = render(
      <ChatPanel
        runId="r1"
        artifacts={[
          chat("b", { role: "assistant", content: "second" }, "2026-01-01T00:00:02Z"),
          chat("a", { role: "system" }, "2026-01-01T00:00:01Z"),
          { ...chat("x", { content: "not chat" }, "2026-01-01T00:00:00Z"), type: "Plan" },
        ]}
      />,
    );
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.queryByText("not chat")).toBeNull();
    const bubbles = container.querySelectorAll(".max-w-\\[85\\%\\]");
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]!.className).toContain("bg-accent/20");
    expect(bubbles[0]!.textContent).toBe("");
    expect(bubbles[1]!.textContent).toBe("second");
  });

  it("scrolls the anchor into view when supported", () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    render(<ChatPanel runId="r1" artifacts={[chat("a", { role: "user", content: "hi" }, "2026-01-01T00:00:00Z")]} />);
    expect(spy).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("shows a generic message for non-Error failures and keeps the input", async () => {
    send.mockRejectedValue("bad");
    render(<ChatPanel runId="r1" artifacts={[]} />);
    const input = screen.getByPlaceholderText("Ask the agent about this run…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Chat request failed")).toBeTruthy();
    expect(input.value).toBe("question");
  });

  it("ignores whitespace-only submits and resubmits while loading", async () => {
    let resolve!: (v: unknown) => void;
    send.mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = render(<ChatPanel runId="r1" artifacts={[]} />);
    const form = container.querySelector("form")!;
    const input = screen.getByPlaceholderText("Ask the agent about this run…") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(form);
    expect(send).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: " hello " } });
    fireEvent.submit(form);
    expect(send).toHaveBeenCalledWith("r1", "hello");
    expect(await screen.findByText(/Agent is thinking/)).toBeTruthy();
    fireEvent.submit(form);
    expect(send).toHaveBeenCalledTimes(1);

    resolve({ reply: "ok", durationMs: 1 });
    await waitFor(() => expect(input.value).toBe(""));
    expect(screen.queryByText(/Agent is thinking/)).toBeNull();
  });
});
