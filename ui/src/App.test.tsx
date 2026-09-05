import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div>Dashboard Page</div>,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div>Run Detail Page</div>,
}));

import App from "./App.tsx";

describe("App", () => {
  it("renders the dashboard page at the root route", () => {
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(screen.getByText("Dashboard Page")).toBeDefined();
  });

  it("renders the run detail page at /runs/:id", () => {
    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);
    expect(screen.getByText("Run Detail Page")).toBeDefined();
  });
});
