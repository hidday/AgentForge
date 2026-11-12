import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

// Additional tests closing coverage gaps in ChatPanel.tsx not exercised by
// ChatPanel.test.tsx: the collapse/expand toggle (line 83) and the
// scrollIntoView guard in the auto-scroll effect (line 53).
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

const RUN_ID = "run-1";

describe("ChatPanel – collapse toggle and auto-scroll guard", () => {
  let originalScrollIntoView: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalScrollIntoView = (
      HTMLElement.prototype as unknown as { scrollIntoView?: () => void }
    ).scrollIntoView;
  });

  afterEach(() => {
    (HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView =
      originalScrollIntoView;
  });

  it("collapses the message list when the header is clicked, and expands it again", async () => {
    const user = userEvent.setup();
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: RUN_ID,
        type: "ChatMessage",
        version: 1,
        payloadJson: { role: "user", content: "Hello there" },
        rawText: "Hello there",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];

    render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    // Open by default — message visible.
    expect(screen.getByText("Hello there")).toBeDefined();

    const header = screen.getByRole("button", { name: /chat with agent/i });
    await user.click(header);

    // Collapsed: message list (and its content) should no longer be present.
    expect(screen.queryByText("Hello there")).toBeNull();

    await user.click(header);

    // Expanded again.
    expect(screen.getByText("Hello there")).toBeDefined();
  });

  it("calls scrollIntoView when the ref's element exposes it as a function", () => {
    const scrollIntoViewMock = vi.fn();
    (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      scrollIntoViewMock;

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("does not throw when scrollIntoView is not implemented on the element", () => {
    (HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView =
      undefined;

    expect(() => render(<ChatPanel runId={RUN_ID} artifacts={[]} />)).not.toThrow();
  });

  it("falls back to an empty string when a ChatMessage artifact has no content field", () => {
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: RUN_ID,
        type: "ChatMessage",
        version: 1,
        payloadJson: { role: "user" },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];

    const { container } = render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    // The message bubble renders with empty content; no crash, and the
    // count badge still reflects one message.
    expect(screen.getByText("1")).toBeDefined();
    expect(container.querySelector(".whitespace-pre-wrap")?.textContent).toBe("");
  });

  it("submitting the form with a whitespace-only message is a no-op (bypassing the disabled button)", async () => {
    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "   ");

    const form = input.closest("form")!;
    fireEvent.submit(form);

    expect(mockApi.sendChatMessage).not.toHaveBeenCalled();
  });

  it("shows a generic error message when a non-Error value is thrown", async () => {
    mockApi.sendChatMessage.mockRejectedValue("boom");

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "Hi");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText(/chat request failed/i)).toBeDefined();
  });
});
