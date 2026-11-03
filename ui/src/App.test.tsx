import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page">dashboard</div>,
}));
vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page">run detail</div>,
}));

import App from "./App";

describe("App", () => {
  it("mounts without throwing and renders the dashboard route by default", () => {
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });

  it("renders the run detail route for /runs/:id", () => {
    window.history.pushState({}, "", "/runs/abc123");
    render(<App />);
    expect(screen.getByTestId("run-detail-page")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });
});
