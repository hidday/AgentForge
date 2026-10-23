import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Artifact } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: { sendChatMessage: vi.fn() },
}));

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
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

describe("ChatPanel gap-fill coverage", () => {
  let originalScrollIntoView: unknown;

  beforeEach(() => {
    originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
  });

  afterEach(() => {
    window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView as never;
  });

  it("calls scrollIntoView on the bottom anchor when it is a function and the message count changes", () => {
    const scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const { rerender } = render(<ChatPanel runId="run-1" artifacts={[]} />);
    // Initial mount already triggers the effect once.
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });

    scrollIntoViewMock.mockClear();

    rerender(
      <ChatPanel
        runId="run-1"
        artifacts={[makeArtifact("user", "Hi", "a1", "2024-01-01T00:00:00Z")]}
      />,
    );
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("does not throw when scrollIntoView is not implemented (e.g. default jsdom element)", () => {
    // jsdom's HTMLElement does not implement scrollIntoView by default.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window.HTMLElement.prototype as any).scrollIntoView;
    expect(() => render(<ChatPanel runId="run-1" artifacts={[]} />)).not.toThrow();
  });

  it("collapses the panel body when the header is clicked, hiding input and messages", async () => {
    render(
      <ChatPanel
        runId="run-1"
        artifacts={[makeArtifact("user", "Hello", "a1", "2024-01-01T00:00:00Z")]}
      />,
    );

    // Open by default.
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();
    expect(screen.getByText("Hello")).toBeDefined();

    await userEvent.click(screen.getByText("Chat with Agent"));

    expect(screen.queryByPlaceholderText(/ask the agent/i)).toBeNull();
    expect(screen.queryByText("Hello")).toBeNull();

    // Click again to re-expand.
    await userEvent.click(screen.getByText("Chat with Agent"));
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();
  });
});
