import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("ChatPanel - additional branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collapses the message list when the header is clicked, and expands it again", async () => {
    const user = userEvent.setup();
    const artifacts = [
      makeArtifact("user", "hello", "a1", "2024-01-01T00:00:00Z"),
    ];

    render(<ChatPanel runId="run-1" artifacts={artifacts} />);

    expect(screen.getByText("hello")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /Chat with Agent/i }));
    expect(screen.queryByText("hello")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Chat with Agent/i }));
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("scrolls to the bottom when a new message is appended and scrollIntoView is available", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const { rerender } = render(
      <ChatPanel
        runId="run-1"
        artifacts={[makeArtifact("user", "first", "a1", "2024-01-01T00:00:00Z")]}
      />,
    );
    scrollIntoView.mockClear();

    rerender(
      <ChatPanel
        runId="run-1"
        artifacts={[
          makeArtifact("user", "first", "a1", "2024-01-01T00:00:00Z"),
          makeArtifact("assistant", "second", "a2", "2024-01-01T00:01:00Z"),
        ]}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
  });
});
