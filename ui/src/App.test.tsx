import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page">Dashboard Page</div>,
}));
vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page">Run Detail Page</div>,
}));

import App from "./App.tsx";

function renderAtPath(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

describe("App", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the DashboardPage at the root route", () => {
    renderAtPath("/");
    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });

  it("renders the RunDetailPage at /runs/:id", () => {
    renderAtPath("/runs/abc-123");
    expect(screen.getByTestId("run-detail-page")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });

  it("renders nothing for an unmatched route (no catch-all defined)", () => {
    renderAtPath("/does-not-exist");
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });
});
