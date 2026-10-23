import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn().mockResolvedValue({ runs: [] }),
  },
}));

class MockEventSource {
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  close() {}
}

import App from "./App.tsx";

describe("App", () => {
  let originalEventSource: unknown;

  beforeEach(() => {
    originalEventSource = (globalThis as Record<string, unknown>).EventSource;
    (globalThis as Record<string, unknown>).EventSource = MockEventSource;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).EventSource = originalEventSource;
  });

  it("mounts without crashing and renders the dashboard at the root route", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Runs")).toBeDefined();
    });

    // Top-level structure: the dashboard's header and filter bar should be present.
    expect(screen.getByText(/Monitor and manage AI development agent runs/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /sync from linear/i })).toBeDefined();
  });
});
