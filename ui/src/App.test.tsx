import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// App wires up its own BrowserRouter, so we drive routing by setting
// window.location/history before rendering, and stub out the page
// components (which fetch data via hooks) so this stays a pure
// routing test.
vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page">Dashboard</div>,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page">Run Detail</div>,
}));

import App from "./App.tsx";

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

describe("App", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("renders without crashing", () => {
    renderAt("/");
    expect(document.body).toBeDefined();
  });

  it("renders the DashboardPage at the root route", () => {
    renderAt("/");
    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });

  it("renders the RunDetailPage at /runs/:id", () => {
    renderAt("/runs/abc-123");
    expect(screen.getByTestId("run-detail-page")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });

  it("does not render either page for an unmatched route", () => {
    renderAt("/some/unknown/path");
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });
});
