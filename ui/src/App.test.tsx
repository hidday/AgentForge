import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page">Dashboard</div>,
}));
vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page">Run Detail</div>,
}));

import App from "./App.tsx";

describe("App", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("renders the DashboardPage at the root path", () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });

  it("renders the RunDetailPage for a /runs/:id path", () => {
    window.history.pushState({}, "", "/runs/abc-123");
    render(<App />);

    expect(screen.getByTestId("run-detail-page")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });
});
