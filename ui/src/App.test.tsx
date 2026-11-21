import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useParams } from "react-router-dom";

vi.mock("@/pages/DashboardPage.tsx", () => ({
  DashboardPage: () => <div>dashboard-page</div>,
}));
vi.mock("@/pages/RunDetailPage.tsx", () => ({
  RunDetailPage: function RunDetailStub() {
    const { id } = useParams();
    return <div>run-detail:{id}</div>;
  },
}));

import App from "./App.tsx";

afterEach(() => {
  window.history.pushState({}, "", "/");
});

describe("App routing", () => {
  it("renders the dashboard at /", () => {
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(screen.getByText("dashboard-page")).toBeTruthy();
    expect(screen.queryByText(/run-detail/)).toBeNull();
  });

  it("renders run detail with the id param at /runs/:id", () => {
    window.history.pushState({}, "", "/runs/abc-123");
    render(<App />);
    expect(screen.getByText("run-detail:abc-123")).toBeTruthy();
    expect(screen.queryByText("dashboard-page")).toBeNull();
  });

  it("renders nothing for unknown routes", () => {
    window.history.pushState({}, "", "/nope");
    const { container } = render(<App />);
    expect(container.textContent).toBe("");
  });
});
