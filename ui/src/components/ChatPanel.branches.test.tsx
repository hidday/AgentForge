import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

// Covers the two small remaining branches in ChatPanel.tsx:
//  - the header button's collapse/expand toggle (onClick setOpen)
//  - the scrollIntoView auto-scroll effect when the DOM API is available
//    (jsdom doesn't implement it by default, so the existing tests never hit it)
describe("ChatPanel additional branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("collapses the message list when the header is clicked, and expands it again", async () => {
    render(<ChatPanel runId="run-1" artifacts={[]} />);

    // Open by default: message list and input form are visible.
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();

    const header = screen.getByRole("button", { name: /chat with agent/i });
    await userEvent.click(header);

    expect(screen.queryByPlaceholderText(/ask the agent/i)).toBeNull();

    await userEvent.click(header);
    expect(screen.getByPlaceholderText(/ask the agent/i)).toBeDefined();
  });

  it("calls scrollIntoView on the anchor element when the DOM provides it", () => {
    const scrollIntoView = vi.fn();
    // jsdom does not implement scrollIntoView; provide it for this test only.
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(<ChatPanel runId="run-1" artifacts={[]} />);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });

    // @ts-expect-error -- cleanup the stub so other tests see the jsdom default
    delete HTMLElement.prototype.scrollIntoView;
  });
});
