import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

// Mock the api module before importing
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

describe("ChatPanel branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an empty message body when the artifact payload has no content field", () => {
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: RUN_ID,
        type: "ChatMessage",
        version: 1,
        payloadJson: { role: "user" },
        rawText: "",
        createdAt: "2024-01-01T00:00:01Z",
      },
    ];
    render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);
    // The message bubble renders, just with empty text content.
    const bubble = document.querySelector(".whitespace-pre-wrap");
    expect(bubble?.textContent).toBe("");
  });

  it("shows a generic error message when the rejection is not an Error instance", async () => {
    mockApi.sendChatMessage.mockRejectedValue("some string rejection");

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "Question");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText(/chat request failed/i)).toBeDefined();
  });

  it("ignores a duplicate form submission while a send is already in flight", async () => {
    let resolveRequest!: (v: { reply: string; durationMs: number }) => void;
    mockApi.sendChatMessage.mockReturnValue(
      new Promise<{ reply: string; durationMs: number }>((res) => {
        resolveRequest = res;
      }),
    );

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i) as HTMLInputElement;
    await userEvent.type(input, "Question");
    const form = input.closest("form")!;

    act(() => {
      fireEvent.submit(form);
    });
    // A second submit fired synchronously, while isLoading is already true,
    // must be ignored (hits the `isLoading` branch of the early return).
    act(() => {
      fireEvent.submit(form);
    });

    expect(mockApi.sendChatMessage).toHaveBeenCalledTimes(1);

    act(() => {
      resolveRequest({ reply: "Done", durationMs: 10 });
    });
  });

  it("collapses the panel when the header is clicked, hiding the message list and input", async () => {
    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);

    // Initially open: input form is visible.
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();

    const header = screen.getByRole("button", { name: /chat with agent/i });
    await userEvent.click(header);

    expect(screen.queryByPlaceholderText(/ask the agent/i)).toBeNull();
  });

  it("re-expands the panel when the header is clicked a second time", async () => {
    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);

    const header = screen.getByRole("button", { name: /chat with agent/i });
    await userEvent.click(header); // collapse
    expect(screen.queryByPlaceholderText(/ask the agent/i)).toBeNull();

    await userEvent.click(header); // expand
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();
  });

  describe("with scrollIntoView implemented", () => {
    let scrollIntoViewMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      scrollIntoViewMock = vi.fn();
      // jsdom does not implement scrollIntoView by default; this component
      // guards on `typeof ... === "function"` before calling it, so we
      // polyfill it to exercise the true branch and the call itself.
      HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    });

    afterEach(() => {
      // @ts-expect-error -- cleanup the polyfill we added above
      delete HTMLElement.prototype.scrollIntoView;
    });

    it("scrolls the message anchor into view when the message count changes", () => {
      const artifacts: Artifact[] = [
        makeArtifact("user", "Hello", "a1", "2024-01-01T00:00:01Z"),
      ];
      render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });
    });
  });
});
