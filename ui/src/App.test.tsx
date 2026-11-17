import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page" />,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page" />,
}));

import App from "./App.tsx";

function setPath(path: string) {
  window.history.pushState({}, "", path);
}

describe("App routing", () => {
  afterEach(() => {
    setPath("/");
  });

  it("renders DashboardPage at the root path", () => {
    setPath("/");
    render(<App />);
    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });

  it("renders RunDetailPage at /runs/:id", () => {
    setPath("/runs/abc-123");
    render(<App />);
    expect(screen.getByTestId("run-detail-page")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });
});
