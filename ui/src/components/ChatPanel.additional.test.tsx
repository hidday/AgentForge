import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

// Mock the api module before importing (same convention as ChatPanel.test.tsx)
vi.mock("@/api/client.ts", () => ({
  api: {
    sendChatMessage: vi.fn(),
  },
}));

// Mock the Markdown component so we can assert it's called with the right content
vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { ChatPanel } from "./ChatPanel.tsx";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { sendChatMessage: ReturnType<typeof vi.fn> };

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

describe("ChatPanel — additional coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to an empty string when a ChatMessage artifact's payload has no content field", () => {
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: RUN_ID,
        type: "ChatMessage",
        version: 1,
        payloadJson: { role: "user" }, // no `content` key at all
        rawText: "",
        createdAt: "2024-01-01T00:00:01Z",
      },
    ];
    const { container } = render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    // The message bubble renders with empty text content instead of throwing.
    const bubble = container.querySelector(".whitespace-pre-wrap");
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toBe("");
  });

  it("submitting the form directly with blank/whitespace-only input does not call the API", () => {
    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);

    // Bypass the disabled submit button by firing a native form submit
    // event directly, exercising the `!trimmed` guard in handleSubmit.
    const form = screen.getByPlaceholderText(/ask the agent/i).closest("form")!;
    fireEvent.submit(form);

    expect(mockApi.sendChatMessage).not.toHaveBeenCalled();
  });

  it("submitting the form again while a request is already in flight is a no-op (isLoading guard)", async () => {
    let resolveRequest!: (v: { reply: string; durationMs: number }) => void;
    mockApi.sendChatMessage.mockReturnValue(
      new Promise<{ reply: string; durationMs: number }>((res) => {
        resolveRequest = res;
      }),
    );

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i) as HTMLInputElement;
    await userEvent.type(input, "First question");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(mockApi.sendChatMessage).toHaveBeenCalledTimes(1);

    // Directly submit the form again (bypassing the disabled button/input)
    // while isLoading is still true — the `isLoading` guard should stop a
    // second API call from firing.
    const form = input.closest("form")!;
    fireEvent.submit(form);

    expect(mockApi.sendChatMessage).toHaveBeenCalledTimes(1);

    resolveRequest({ reply: "Done", durationMs: 10 });
    await waitFor(() => {
      expect(screen.queryByText(/agent is thinking/i)).toBeNull();
    });
  });

  it("shows a generic error message when the request rejects with a non-Error value", async () => {
    mockApi.sendChatMessage.mockRejectedValue("connection reset");

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "Question");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText("Chat request failed")).toBeDefined();
    });
  });

  afterEach(() => {
    // Avoid leaking a stubbed scrollIntoView into other test files.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window.HTMLElement.prototype as any).scrollIntoView;
  });

  it("calls scrollIntoView on the anchor element when jsdom provides it and the message count changes", () => {
    const scrollIntoViewMock = vi.fn();
    // jsdom does not implement scrollIntoView by default, so ChatPanel guards
    // the call with `typeof ... === "function"`. Stub it so that guard's
    // true branch (the actual scrollIntoView invocation) executes.
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const { rerender } = render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    // Effect runs on mount too (messages.length changes from "never run" to 0).
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });

    scrollIntoViewMock.mockClear();

    const artifacts: Artifact[] = [
      makeArtifact("user", "Hello", "a1", "2024-01-01T00:00:01Z"),
    ];
    rerender(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    // messages.length changed 0 -> 1, so the effect should fire again.
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("does not throw when scrollIntoView is unavailable (jsdom default)", () => {
    // No stub applied — bottomRef.current.scrollIntoView is undefined in jsdom,
    // so the guard's false branch is taken and nothing is called.
    expect(() => render(<ChatPanel runId={RUN_ID} artifacts={[]} />)).not.toThrow();
  });

  it("collapses the message list when the header is clicked, and re-expands on a second click", async () => {
    const artifacts: Artifact[] = [
      makeArtifact("user", "Visible message", "a1", "2024-01-01T00:00:01Z"),
    ];
    render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    // Open by default.
    expect(screen.getByText("Visible message")).toBeDefined();

    const header = screen.getByRole("button", { name: /chat with agent/i });
    await userEvent.click(header);

    // Collapsed: message list and input form should no longer be in the DOM.
    expect(screen.queryByText("Visible message")).toBeNull();
    expect(screen.queryByPlaceholderText(/ask the agent/i)).toBeNull();

    await userEvent.click(header);

    // Re-expanded.
    expect(screen.getByText("Visible message")).toBeDefined();
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();
  });
});
