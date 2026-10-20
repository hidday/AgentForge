import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-stub">Dashboard stub</div>,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-stub">RunDetail stub</div>,
}));

import App from "./App.tsx";

describe("App", () => {
  it("renders the Dashboard stub at the root path '/'", () => {
    window.history.pushState({}, "", "/");

    render(<App />);

    expect(screen.getByTestId("dashboard-stub")).toBeDefined();
    expect(screen.queryByTestId("run-detail-stub")).toBeNull();
  });

  it("renders the RunDetail stub at '/runs/:id'", () => {
    window.history.pushState({}, "", "/runs/abc");

    render(<App />);

    expect(screen.getByTestId("run-detail-stub")).toBeDefined();
    expect(screen.queryByTestId("dashboard-stub")).toBeNull();
  });

  it("renders neither stub for an unmatched path", () => {
    window.history.pushState({}, "", "/does-not-exist");

    render(<App />);

    expect(screen.queryByTestId("dashboard-stub")).toBeNull();
    expect(screen.queryByTestId("run-detail-stub")).toBeNull();
  });
});
