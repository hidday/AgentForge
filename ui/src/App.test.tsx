import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// App.tsx hardcodes a BrowserRouter internally, so to drive specific routes
// in tests we mock react-router-dom's BrowserRouter to render children
// inside a MemoryRouter that we control via history/initialEntries through
// module state set per-test.
let currentPath = "/";

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    BrowserRouter: ({ children }: { children: ReactNode }) => (
      <actual.MemoryRouter initialEntries={[currentPath]}>
        {children}
      </actual.MemoryRouter>
    ),
  };
});

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div data-testid="dashboard-page">Dashboard Page</div>,
}));

vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: () => <div data-testid="run-detail-page">Run Detail Page</div>,
}));

import App from "./App.tsx";

describe("App", () => {
  it("renders the DashboardPage at the root path '/'", () => {
    currentPath = "/";
    render(<App />);
    expect(screen.getByTestId("dashboard-page")).toBeDefined();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });

  it("renders the RunDetailPage at '/runs/:id'", () => {
    currentPath = "/runs/abc-123";
    render(<App />);
    expect(screen.getByTestId("run-detail-page")).toBeDefined();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });

  it("renders nothing matching for an unknown route (no route defined)", () => {
    currentPath = "/some/unknown/route";
    render(<App />);
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
    expect(screen.queryByTestId("run-detail-page")).toBeNull();
  });
});
