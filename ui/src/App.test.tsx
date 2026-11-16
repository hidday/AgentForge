import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App.tsx";

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page">Dashboard Page</div>,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page">Run Detail Page</div>,
}));

describe("App", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("renders without throwing", () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it("renders the dashboard page on the root route", () => {
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });

  it("renders the run detail page on a /runs/:id route", () => {
    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);
    expect(screen.getByTestId("run-detail-page")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });

  it("renders neither known page for an unmatched route", () => {
    window.history.pushState({}, "", "/does-not-exist");
    render(<App />);
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });
});
