import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

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

function makeArtifact(
  role: "user" | "assistant",
  content: string,
  id: string,
  createdAt: string,
): Artifact {
  return {
    id,
    runId: "run-1",
    type: "ChatMessage",
    version: 1,
    payloadJson: { role, content },
    rawText: content,
    createdAt,
  };
}

const RUN_ID = "run-1";

describe("ChatPanel additional branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collapses the panel body when the header is clicked, hiding input and messages", async () => {
    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);

    // Open by default: input is present.
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();

    const header = screen.getByText("Chat with Agent").closest("button")!;
    await userEvent.click(header);

    expect(screen.queryByPlaceholderText(/ask the agent/i)).toBeNull();
    expect(screen.queryByText(/No messages yet/i)).toBeNull();

    // Click again to reopen.
    await userEvent.click(header);
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();
  });

  it("calls scrollIntoView on the anchor element when it supports the API", () => {
    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = (
      window.HTMLElement.prototype as unknown as {
        scrollIntoView?: (...args: unknown[]) => void;
      }
    ).scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    try {
      const artifacts: Artifact[] = [
        makeArtifact("user", "Hi there", "a1", "2024-01-01T00:00:01Z"),
      ];
      render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });
    } finally {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView as (
        ...args: unknown[]
      ) => void;
    }
  });

  it("does nothing when the form is submitted directly with only whitespace input", async () => {
    const { api } = await import("@/api/client.ts");
    const mockApi = api as unknown as { sendChatMessage: ReturnType<typeof vi.fn> };

    const { container } = render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i) as HTMLInputElement;

    // Bypass the disabled Send button by submitting the form directly while
    // the trimmed input value is empty, exercising the early-return guard.
    await userEvent.type(input, "   ");
    const form = container.querySelector("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(mockApi.sendChatMessage).not.toHaveBeenCalled();
    expect(screen.queryByText(/agent is thinking/i)).toBeNull();
  });

  it("falls back to an empty string when a ChatMessage artifact has no content field", () => {
    const artifact: Artifact = {
      id: "a1",
      runId: RUN_ID,
      type: "ChatMessage",
      version: 1,
      payloadJson: { role: "user" },
      rawText: "",
      createdAt: "2024-01-01T00:00:01Z",
    };
    render(<ChatPanel runId={RUN_ID} artifacts={[artifact]} />);

    // The empty-state message should not show (one message exists), and the
    // message bubble should have been rendered with empty text content.
    expect(screen.queryByText(/No messages yet/i)).toBeNull();
  });

  it("shows a generic error message when the API rejects with a non-Error value", async () => {
    const { api } = await import("@/api/client.ts");
    const mockApi = api as unknown as { sendChatMessage: ReturnType<typeof vi.fn> };
    mockApi.sendChatMessage.mockRejectedValue("some string failure");

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "Question");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText("Chat request failed")).toBeDefined();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
