import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { sendChatMessage: ReturnType<typeof vi.fn> };

function makeArtifact(payload: Record<string, unknown>, id = "a1"): Artifact {
  return {
    id,
    runId: "run-1",
    type: "ChatMessage",
    version: 1,
    payloadJson: payload,
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

describe("ChatPanel (gaps)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (HTMLElement.prototype as any).scrollIntoView;
  });

  it("defaults content to an empty string when the artifact payload has no content field", () => {
    const artifact = makeArtifact({ role: "user" });
    render(<ChatPanel runId="run-1" artifacts={[artifact]} />);
    // The message bubble renders with empty text content but should still exist.
    const bubble = screen.getByText("", { selector: "span.whitespace-pre-wrap" });
    expect(bubble).toBeDefined();
  });

  it("calls scrollIntoView when the ref element supports it", () => {
    const scrollSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLElement.prototype as any).scrollIntoView = scrollSpy;

    render(<ChatPanel runId="run-1" artifacts={[]} />);

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("collapses the panel when the header is clicked, swapping Chevron direction", async () => {
    const user = userEvent.setup();
    render(<ChatPanel runId="run-1" artifacts={[]} />);

    // Open by default -- the message list is visible.
    expect(screen.getByText(/No messages yet/i)).toBeDefined();

    const header = screen.getByRole("button", { name: /Chat with Agent/i });
    await user.click(header);

    expect(screen.queryByText(/No messages yet/i)).toBeNull();

    await user.click(header);
    expect(screen.getByText(/No messages yet/i)).toBeDefined();
  });

  it("submitting the form with a blank (whitespace-only) input is a no-op", () => {
    render(<ChatPanel runId="run-1" artifacts={[]} />);
    const form = document.querySelector("form");
    expect(form).toBeTruthy();

    fireEvent.submit(form!);

    expect(mockApi.sendChatMessage).not.toHaveBeenCalled();
  });

  it("falls back to a generic error message when a non-Error is thrown from sendChatMessage", async () => {
    mockApi.sendChatMessage.mockRejectedValue("not an Error instance");
    const user = userEvent.setup();

    render(<ChatPanel runId="run-1" artifacts={[]} />);

    const input = screen.getByPlaceholderText(/Ask the agent/i);
    await user.type(input, "Hello");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/Chat request failed/i)).toBeDefined();
    });
  });
});
