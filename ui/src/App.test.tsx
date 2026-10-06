import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// App.tsx wires up BrowserRouter + Routes. We stub out the page components so
// this test only asserts routing behavior (which page mounts for which URL),
// not the pages' own rendering (covered by their own test files).
vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page">Dashboard</div>,
}));
vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page">Run Detail</div>,
}));

import App from "./App.tsx";

describe("App", () => {
  it("renders the dashboard page at the root route", () => {
    window.history.pushState({}, "", "/");

    render(<App />);

    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });

  it("renders the run detail page at /runs/:id", () => {
    window.history.pushState({}, "", "/runs/abc-123");

    render(<App />);

    expect(screen.getByTestId("run-detail-page")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });
});
