import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

// Mirrors the mocking setup in ChatPanel.test.tsx — this file covers the
// branches that test file leaves untested: the scrollIntoView call, the
// header collapse/expand toggle, the empty-content fallback when rendering
// a message, the handleSubmit no-op guard, and the non-Error rejection
// fallback message.
vi.mock("@/api/client.ts", () => ({
  api: {
    sendChatMessage: vi.fn(),
  },
}));

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { ChatPanel } from "./ChatPanel.tsx";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { sendChatMessage: ReturnType<typeof vi.fn> };

function makeArtifact(payload: { role?: string; content?: string }): Artifact {
  return {
    id: "a1",
    runId: "run-1",
    type: "ChatMessage",
    version: 1,
    payloadJson: payload,
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

describe("ChatPanel gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls scrollIntoView on the anchor element when it supports it", () => {
    const scrollIntoView = vi.fn();
    // jsdom does not implement scrollIntoView by default.
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<ChatPanel runId="run-1" artifacts={[]} />);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });

    // @ts-expect-error cleanup the test-only stub
    delete Element.prototype.scrollIntoView;
  });

  it("collapses the panel body when the header is clicked, and expands it again", async () => {
    render(<ChatPanel runId="run-1" artifacts={[]} />);

    // Open by default.
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();

    const header = screen.getByRole("button", { name: /chat with agent/i });
    await userEvent.click(header);

    // Collapsed: the input and message list are no longer rendered.
    expect(screen.queryByPlaceholderText(/ask the agent/i)).toBeNull();

    await userEvent.click(header);

    // Expanded again.
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();
  });

  it("renders an empty message body when the artifact payload has no content", () => {
    render(
      <ChatPanel
        runId="run-1"
        artifacts={[makeArtifact({ role: "user" })]}
      />,
    );

    // The message bubble renders, but with empty text (the "" fallback).
    const bubble = document.querySelector(".whitespace-pre-wrap");
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toBe("");
  });

  it("does not submit when the trimmed input is empty (form submitted directly)", () => {
    const { container } = render(<ChatPanel runId="run-1" artifacts={[]} />);
    const input = screen.getByPlaceholderText(
      /ask the agent/i,
    ) as HTMLInputElement;

    // Bypass the disabled Send button by dispatching submit directly, with
    // whitespace-only input so `trimmed` is falsy.
    fireEvent.change(input, { target: { value: "   " } });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    expect(mockApi.sendChatMessage).not.toHaveBeenCalled();
  });

  it("shows a generic error message when the request rejects with a non-Error value", async () => {
    mockApi.sendChatMessage.mockRejectedValue("network down");

    render(<ChatPanel runId="run-1" artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "Hello");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText("Chat request failed")).toBeDefined();
    });
  });
});
