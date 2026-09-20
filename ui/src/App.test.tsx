import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App.tsx";

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page" />,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page" />,
}));

describe("App", () => {
  it("renders the dashboard page at the root route", () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });

  it("renders the run detail page at /runs/:id", () => {
    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);

    expect(screen.getByTestId("run-detail-page")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });
});
