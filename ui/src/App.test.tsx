import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page">Dashboard</div>,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page">RunDetail</div>,
}));

import App from "./App";

describe("App routing", () => {
  it("renders DashboardPage at the root path", () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });

  it("renders RunDetailPage at /runs/:id", () => {
    window.history.pushState({}, "", "/runs/abc-123");
    render(<App />);

    expect(screen.getByTestId("run-detail-page")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });

  it("renders RunDetailPage for a different run id", () => {
    window.history.pushState({}, "", "/runs/some-other-id");
    render(<App />);

    expect(screen.getByTestId("run-detail-page")).toBeDefined();
  });

  it("renders nothing matched for an unknown path", () => {
    window.history.pushState({}, "", "/does/not/exist");
    const { container } = render(<App />);

    expect(screen.queryByTestId("dashboard-page")).toBeNull();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
    // Routes with no match render nothing for its own content.
    expect(container.textContent).toBe("");
  });
});
