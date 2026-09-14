import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div>Dashboard Page Stub</div>,
}));
vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div>Run Detail Page Stub</div>,
}));

import App from "./App.tsx";

describe("App", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("renders the dashboard at the root route", () => {
    render(<App />);
    expect(screen.getByText("Dashboard Page Stub")).toBeDefined();
  });

  it("renders the run detail page for /runs/:id", () => {
    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);
    expect(screen.getByText("Run Detail Page Stub")).toBeDefined();
  });
});
