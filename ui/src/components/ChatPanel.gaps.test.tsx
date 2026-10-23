import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    sendChatMessage: vi.fn(),
  },
}));

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

import { ChatPanel } from "./ChatPanel.tsx";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { sendChatMessage: ReturnType<typeof vi.fn> };

function makeArtifact(payloadJson: unknown, id: string, createdAt: string): Artifact {
  return {
    id,
    runId: "run-1",
    type: "ChatMessage",
    version: 1,
    payloadJson,
    rawText: "",
    createdAt,
  };
}

const RUN_ID = "run-1";

describe("ChatPanel gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an empty string for a ChatMessage artifact whose payload has no content field", () => {
    const artifacts: Artifact[] = [
      makeArtifact({ role: "user" }, "a1", "2024-01-01T00:00:01Z"),
    ];
    render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    // The bubble renders, with no text content, and the empty-state message is gone.
    expect(screen.queryByText(/No messages yet/i)).toBeNull();
    const bubble = document.querySelector("span.whitespace-pre-wrap");
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toBe("");
  });

  it("does not call sendChatMessage when the form is submitted with only whitespace input", () => {
    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "   " } });
    const form = input.closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    expect(mockApi.sendChatMessage).not.toHaveBeenCalled();
  });

  it("ignores a second submit while a request is already in flight (isLoading guard)", async () => {
    let resolveRequest!: (v: { reply: string; durationMs: number }) => void;
    mockApi.sendChatMessage.mockReturnValue(
      new Promise<{ reply: string; durationMs: number }>((res) => {
        resolveRequest = res;
      }),
    );

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i) as HTMLInputElement;
    await userEvent.type(input, "First question");
    const form = input.closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    expect(mockApi.sendChatMessage).toHaveBeenCalledTimes(1);

    // Submitting again while the first call is still pending must be a no-op,
    // even though the input retains its value (it's disabled, but the form
    // handler itself must also guard on isLoading).
    fireEvent.submit(form);
    expect(mockApi.sendChatMessage).toHaveBeenCalledTimes(1);

    resolveRequest({ reply: "done", durationMs: 1 });
    await waitFor(() => {
      expect(screen.queryByText(/agent is thinking/i)).toBeNull();
    });
  });

  it("falls back to a generic error message when sendChatMessage rejects with a non-Error value", async () => {
    mockApi.sendChatMessage.mockRejectedValue("some string rejection");

    render(<ChatPanel runId={RUN_ID} artifacts={[]} />);
    const input = screen.getByPlaceholderText(/ask the agent/i);
    await userEvent.type(input, "Will fail oddly");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText("Chat request failed")).toBeDefined();
    });
  });
});
