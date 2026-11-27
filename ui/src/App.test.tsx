import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// App.tsx pulls in real page components which in turn make API calls and
// use heavier dependencies. Mock them so this test exercises only App's own
// routing/wrapper logic, per repo convention for page-heavy shells.
vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page">Dashboard Page</div>,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page">Run Detail Page</div>,
}));

import App from "./App.tsx";

describe("App", () => {
  it("renders the DashboardPage at the root route", () => {
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });

  it("renders the RunDetailPage at /runs/:id", () => {
    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);
    expect(screen.getByTestId("run-detail-page")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });

  it("renders nothing matching for an unknown route", () => {
    window.history.pushState({}, "", "/does-not-exist");
    const { container } = render(<App />);
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
    // BrowserRouter/Routes still renders its wrapper, just with no matched Route content.
    expect(container).toBeDefined();
  });
});
