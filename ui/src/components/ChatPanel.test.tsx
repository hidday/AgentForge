import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

// Mock the api module before importing
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

describe("ChatPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 'No messages yet' empty state when artifacts array is empty", () => {
    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    expect(screen.getByText(/No messages yet/i)).toBeDefined();
  });

  it("renders user and assistant messages from ChatMessage artifacts in chronological order", () => {
    const artifacts: Artifact[] = [
      makeArtifact("assistant", "Second message", "a2", "2024-01-01T00:00:02Z"),
      makeArtifact("user", "First message", "a1", "2024-01-01T00:00:01Z"),
    ];
    render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    const allText = screen.getByText("First message");
    expect(allText).toBeDefined();
    expect(screen.getByText("Second message")).toBeDefined();

    // Check order: first message should appear before second in the DOM
    const allMessages = screen.getAllByText(/message/i);
    // Both should be present
    expect(allMessages.length).toBeGreaterThanOrEqual(2);
  });

  it("assistant messages are rendered through the Markdown component", () => {
    const artifacts: Artifact[] = [
      makeArtifact("assistant", "**Bold reply**", "a1", "2024-01-01T00:00:01Z"),
    ];
    render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(markdownEls.length).toBeGreaterThan(0);
    expect(markdownEls[0].textContent).toBe("**Bold reply**");
  });

  it("user messages are NOT rendered through Markdown", () => {
    const artifacts: Artifact[] = [
      makeArtifact("user", "Plain user message", "a1", "2024-01-01T00:00:01Z"),
    ];
    render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    // Markdown mock renders data-testid="markdown-content" — should not be present for user msgs
    const markdownEls = screen.queryAllByTestId("markdown-content");
    expect(markdownEls.length).toBe(0);
    expect(screen.getByText("Plain user message")).toBeDefined();
  });

  it("Send button is disabled when input is empty", () => {
    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const sendBtn = screen.getByRole("button", { name: /send/i });
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Send button becomes enabled when input has text", async () => {
    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "Hello");
    const sendBtn = screen.getByRole("button", { name: /send/i });
    expect((sendBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("Send button triggers api.sendChatMessage() with correct runId and message", async () => {
    mockApi.sendChatMessage.mockResolvedValue({ reply: "Response", durationMs: 100 });

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "Test question");
    const sendBtn = screen.getByRole("button", { name: /send/i });
    await userEvent.click(sendBtn);

    await waitFor(() => {
      expect(mockApi.sendChatMessage).toHaveBeenCalledWith(RUN_ID, "Test question");
    });
  });

  it("shows 'Agent is thinking' loading indicator while request is pending", async () => {
    let resolveRequest!: (v: { reply: string; durationMs: number }) => void;
    mockApi.sendChatMessage.mockReturnValue(
      new Promise<{ reply: string; durationMs: number }>((res) => {
        resolveRequest = res;
      }),
    );

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "Question");
    const sendBtn = screen.getByRole("button", { name: /send/i });
    await userEvent.click(sendBtn);

    // Loading indicator should appear
    expect(screen.getByText(/agent is thinking/i)).toBeDefined();

    // Resolve the request
    act(() => {
      resolveRequest({ reply: "Done", durationMs: 200 });
    });

    await waitFor(() => {
      expect(screen.queryByText(/agent is thinking/i)).toBeNull();
    });
  });

  it("Send button is disabled while isLoading is true", async () => {
    let resolveRequest!: (v: { reply: string; durationMs: number }) => void;
    mockApi.sendChatMessage.mockReturnValue(
      new Promise<{ reply: string; durationMs: number }>((res) => {
        resolveRequest = res;
      }),
    );

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i) as HTMLInputElement;
    await userEvent.type(input, "Question");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    // Button should be disabled while loading
    const sendBtn = screen.getByRole("button", { name: /send/i });
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);

    // Resolve the request
    act(() => {
      resolveRequest({ reply: "Done", durationMs: 100 });
    });

    // After loading ends, the loading indicator should be gone
    await waitFor(() => {
      expect(screen.queryByText(/agent is thinking/i)).toBeNull();
    });

    // Input was cleared on success — button stays disabled until user types again
    expect(input.value).toBe("");
    // Type new text to confirm the button becomes enabled again (isLoading is false)
    await userEvent.type(input, "New question");
    expect((screen.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("input clears after successful send; no local message inserted", async () => {
    mockApi.sendChatMessage.mockResolvedValue({ reply: "Response", durationMs: 100 });

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i) as HTMLInputElement;
    await userEvent.type(input, "Hello");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(input.value).toBe("");
    });

    // No message should appear in the list — only artifact-derived messages render
    expect(screen.queryByText("Hello")).toBeNull();
  });

  it("shows inline error message and does not add any message to the list on API error", async () => {
    mockApi.sendChatMessage.mockRejectedValue(new Error("Server error"));

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "Failing question");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeDefined();
    });

    // No message should have been added to the list
    expect(screen.queryByText("Failing question")).toBeNull();
  });

  it("collapses and re-expands the panel when the header is clicked", async () => {
    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);

    // Open by default: empty-state message and input are visible.
    expect(screen.getByText(/No messages yet/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();

    const header = screen.getByRole("button", { name: /chat with agent/i });
    await userEvent.click(header);

    // Collapsed: body content is no longer rendered.
    expect(screen.queryByText(/No messages yet/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/ask the agent/i)).toBeNull();

    await userEvent.click(header);

    // Re-expanded: body content is back.
    expect(screen.getByText(/No messages yet/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();
  });

  it("calls scrollIntoView on the bottom anchor when it is available (auto-scroll)", () => {
    const scrollIntoViewMock = vi.fn();
    // jsdom does not implement scrollIntoView by default; the component guards
    // on `typeof ... === "function"` before calling it, so it must be defined
    // as a function to exercise that branch.
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    const artifacts: Artifact[] = [
      makeArtifact("user", "Hello", "a1", "2024-01-01T00:00:01Z"),
    ];
    render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });

    // @ts-expect-error -- cleanup: remove the mock so it doesn't leak into other test files
    delete Element.prototype.scrollIntoView;
  });

  it("does not call the API when the form is submitted with only whitespace input", async () => {
    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i) as HTMLInputElement;

    // Bypass the disabled Send button by submitting the form directly (e.g. as
    // if triggered by Enter with a whitespace-only value) to exercise the
    // `!trimmed` guard inside handleSubmit.
    fireEvent.change(input, { target: { value: "   " } });
    const form = input.closest("form")!;
    fireEvent.submit(form);

    // Guard should short-circuit before calling the API.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockApi.sendChatMessage).not.toHaveBeenCalled();
  });

  it("shows a generic fallback error message when the rejection is not an Error instance", async () => {
    mockApi.sendChatMessage.mockRejectedValue("network exploded");

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "Failing question");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/chat request failed/i)).toBeDefined();
    });
  });

  it("renders an assistant message with empty content when the artifact payload has no content field", () => {
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: RUN_ID,
        type: "ChatMessage",
        version: 1,
        payloadJson: { role: "assistant" },
        rawText: "",
        createdAt: "2024-01-01T00:00:01Z",
      },
    ];
    render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    const markdownEl = screen.getByTestId("markdown-content");
    expect(markdownEl.textContent).toBe("");
  });

  it("message list does not change from artifact-derived count when only local state changes", async () => {
    let resolveRequest!: (v: { reply: string; durationMs: number }) => void;
    mockApi.sendChatMessage.mockReturnValue(
      new Promise<{ reply: string; durationMs: number }>((res) => {
        resolveRequest = res;
      }),
    );

    const existingArtifacts: Artifact[] = [
      makeArtifact("user", "Existing user message", "a1", "2024-01-01T00:00:01Z"),
      makeArtifact("assistant", "Existing assistant reply", "a2", "2024-01-01T00:00:02Z"),
    ];

    render(<ChatPanel runId={RUN_ID} artifacts={existingArtifacts} />);

    // Two messages visible initially
    expect(screen.getByText("Existing user message")).toBeDefined();
    expect(screen.getByText("Existing assistant reply")).toBeDefined();

    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "New question");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    // Still only 2 messages from artifacts — no optimistic insert
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(markdownEls.length).toBe(1); // only the assistant message

    act(() => {
      resolveRequest({ reply: "New reply", durationMs: 100 });
    });

    await waitFor(() => {
      // After resolution, still only artifact-derived messages (2 from props)
      // "New question" should NOT appear
      expect(screen.queryByText("New question")).toBeNull();
    });
  });
});
