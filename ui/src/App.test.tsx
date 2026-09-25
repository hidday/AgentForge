import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page-marker">Dashboard Page</div>,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page-marker">Run Detail Page</div>,
}));

import App from "./App.tsx";

function setUrl(path: string) {
  window.history.pushState({}, "", path);
}

describe("App routing", () => {
  it("renders DashboardPage at the root path '/'", () => {
    setUrl("/");
    render(<App />);
    expect(screen.getByTestId("dashboard-page-marker")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page-marker")).toBeNull();
  });

  it("renders RunDetailPage at '/runs/:id'", () => {
    setUrl("/runs/abc-123");
    render(<App />);
    expect(screen.getByTestId("run-detail-page-marker")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page-marker")).toBeNull();
  });

  it("renders nothing matching for an unknown path (no route matches)", () => {
    setUrl("/some/unknown/path");
    render(<App />);
    expect(screen.queryByTestId("dashboard-page-marker")).toBeNull();
    expect(screen.queryByTestId("run-detail-page-marker")).toBeNull();
  });
});
