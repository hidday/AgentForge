import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// App renders its own BrowserRouter internally, so route targets are mocked
// as plain components; no real page logic needs to run for this smoke test.
vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page">Dashboard</div>,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page">Run Detail</div>,
}));

import App from "./App.tsx";

describe("App", () => {
  it("renders the default route (DashboardPage) without crashing", () => {
    render(<App />);
    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });
});
