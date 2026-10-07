import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page">Dashboard</div>,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page">Run Detail</div>,
}));

import App from "./App";

function navigateTo(path: string) {
  window.history.pushState({}, "", path);
}

describe("App routing", () => {
  afterEach(() => {
    cleanup();
    navigateTo("/");
  });

  it("renders DashboardPage at the root path", () => {
    navigateTo("/");
    render(<App />);
    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });

  it("renders RunDetailPage at /runs/:id", () => {
    navigateTo("/runs/abc-123");
    render(<App />);
    expect(screen.getByTestId("run-detail-page")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });
});
