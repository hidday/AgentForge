import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App.tsx";

// Mock both page components so mounting App stays isolated from their
// network-calling hooks. BrowserRouter reads window.location at mount time,
// so each test sets the path with pushState before rendering.
vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page" />,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page" />,
}));

describe("App", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("renders the DashboardPage stub at the root path", () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });

  it("renders the RunDetailPage stub at /runs/:id", () => {
    window.history.pushState({}, "", "/runs/abc123");
    render(<App />);

    expect(screen.getByTestId("run-detail-page")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });

  it("renders nothing matching for an unknown path (no route defined)", () => {
    window.history.pushState({}, "", "/does-not-exist");
    const { container } = render(<App />);

    expect(screen.queryByTestId("dashboard-page")).toBeNull();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
    // React Router renders nothing for an unmatched path when there's no catch-all route.
    expect(container.textContent).toBe("");
  });
});
