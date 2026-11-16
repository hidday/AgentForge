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

describe("ChatPanel — collapse toggle (line 83 onClick branch)", () => {
  it("collapses the message list and input form when the header is clicked, and reopens on a second click", async () => {
    const artifacts = [makeArtifact("user", "Hello there", "a1", "2024-01-01T00:00:01Z")];
    render(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    // Open by default — message and input are visible.
    expect(screen.getByText("Hello there")).toBeDefined();
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();

    const header = screen.getByRole("button", { name: /chat with agent/i });
    await userEvent.click(header);

    // Collapsed — the message list and input form are no longer rendered.
    expect(screen.queryByText("Hello there")).toBeNull();
    expect(screen.queryByPlaceholderText(/ask the agent/i)).toBeNull();

    await userEvent.click(header);

    // Reopened.
    expect(screen.getByText("Hello there")).toBeDefined();
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();
  });
});

describe("ChatPanel — auto-scroll effect (line 53 true branch)", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("calls scrollIntoView on the bottom anchor when the message count changes", () => {
    const { rerender } = render(<ChatPanel runId={RUN_ID} artifacts={[]} />);

    // Mounting already runs the effect once (messages.length starts at 0).
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

    const artifacts = [makeArtifact("assistant", "New reply", "a1", "2024-01-01T00:00:01Z")];
    rerender(<ChatPanel runId={RUN_ID} artifacts={artifacts} />);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
  });
});
