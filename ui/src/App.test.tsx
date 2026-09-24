import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page">Dashboard</div>,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page">Run Detail</div>,
}));

import App from "./App.tsx";

describe("App", () => {
  it("renders without throwing and shows the dashboard route at '/'", () => {
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(screen.getByTestId("dashboard-page")).toBeDefined();
  });

  it("renders the run detail page for a '/runs/:id' route", () => {
    window.history.pushState({}, "", "/runs/run-1");
    render(<App />);
    expect(screen.getByTestId("run-detail-page")).toBeDefined();
  });
});
