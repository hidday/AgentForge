import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// App.tsx renders its own <BrowserRouter>, so we drive routing by changing
// the real browser location before each render rather than wrapping in a
// second (conflicting) router. The page components themselves are mocked
// out so this file stays focused on App's own route-branching logic.
vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page">Dashboard</div>,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page">RunDetail</div>,
}));

import App from "./App.tsx";

describe("App", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("renders DashboardPage at the root path", () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });

  it("renders RunDetailPage at /runs/:id", () => {
    window.history.pushState({}, "", "/runs/abc123");
    render(<App />);

    expect(screen.getByTestId("run-detail-page")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });

  it("renders neither page for an unmatched path", () => {
    window.history.pushState({}, "", "/some/unknown/path");

    expect(() => render(<App />)).not.toThrow();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });
});
