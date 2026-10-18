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

const RUN_ID = "run-1";

function makeArtifact(
  role: "user" | "assistant",
  content: string | undefined,
  id: string,
  createdAt: string,
): Artifact {
  return {
    id,
    runId: RUN_ID,
    type: "ChatMessage",
    version: 1,
    payloadJson: { role, content },
    rawText: content ?? "",
    createdAt,
  };
}

describe("ChatPanel – additional branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults a ChatMessage artifact with no content field to an empty string", () => {
    const artifacts: Artifact[] = [
      { ...makeArtifact("user", undefined, "a1", "2024-01-01T00:00:01Z"), payloadJson: { role: "user" } },
    ];
    render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    // The message count badge shows one message even though content was missing.
    expect(screen.getByText("1")).toBeDefined();
  });

  it("collapses the panel and hides the message list when the header is clicked", async () => {
    const artifacts: Artifact[] = [
      makeArtifact("user", "Hello there", "a1", "2024-01-01T00:00:01Z"),
    ];
    render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    expect(screen.getByText("Hello there")).toBeDefined();

    const header = screen.getByText("Chat with Agent").closest("button") as HTMLButtonElement;
    await userEvent.click(header);

    expect(screen.queryByText("Hello there")).toBeNull();
    expect(screen.queryByPlaceholderText(/ask the agent/i)).toBeNull();
  });

  it("does not submit when Enter is pressed with only whitespace in the input", async () => {
    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);

    await userEvent.type(input, "   {Enter}");

    expect(mockApi.sendChatMessage).not.toHaveBeenCalled();
  });

  it("ignores a second form submission while the first one is still in flight", async () => {
    let resolveRequest!: (v: { reply: string; durationMs: number }) => void;
    mockApi.sendChatMessage.mockReturnValue(
      new Promise<{ reply: string; durationMs: number }>((res) => {
        resolveRequest = res;
      }),
    );

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "Question");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(mockApi.sendChatMessage).toHaveBeenCalledTimes(1);

    // Dispatch a submit event directly on the form (bypassing the now-disabled
    // input/button) to simulate a race where handleSubmit runs again while
    // isLoading is already true.
    const form = input.closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    expect(mockApi.sendChatMessage).toHaveBeenCalledTimes(1);

    resolveRequest({ reply: "Done", durationMs: 50 });
    await waitFor(() => expect(screen.queryByText(/agent is thinking/i)).toBeNull());
  });

  it("shows a generic error message when sendChatMessage rejects with a non-Error value", async () => {
    mockApi.sendChatMessage.mockRejectedValue("boom");

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "Question");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText("Chat request failed")).toBeDefined();
    });
  });

  describe("auto-scroll", () => {
    const originalScrollIntoView = (
      HTMLElement.prototype as unknown as { scrollIntoView?: () => void }
    ).scrollIntoView;
    const scrollIntoViewMock = vi.fn();

    beforeEach(() => {
      (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
        scrollIntoViewMock;
      scrollIntoViewMock.mockClear();
    });

    afterEach(() => {
      (HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView =
        originalScrollIntoView;
    });

    it("scrolls the anchor into view when the message count changes", () => {
      const artifacts: Artifact[] = [
        makeArtifact("user", "Hello there", "a1", "2024-01-01T00:00:01Z"),
      ];
      render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });
    });
  });
});
