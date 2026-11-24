import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}));

describe("ExecutionReportView", () => {
  it("renders the execution version, defaulting to 1 when absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders a provided execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders the score bar, percentage, and rationale when a score is present", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.9, scoreRationale: "All checks passed" }}
      />,
    );
    expect(screen.getByText("Score: 90%")).toBeDefined();
    expect(screen.getByText("All checks passed")).toBeDefined();
  });

  it("colors the score bar as blocked for a low score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("colors the score bar as waiting for a middling score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("does not render a score rationale note when score is absent", () => {
    render(<ExecutionReportView report={{ scoreRationale: "orphaned" }} />);
    expect(screen.queryByText("orphaned")).toBeNull();
  });

  it("renders the summary via Markdown", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the feature" }} />);
    expect(screen.getByTestId("md").textContent).toBe("Implemented the feature");
  });

  it("renders a passing check with its name and details", () => {
    render(
      <ExecutionReportView
        report={{ checks: { lint: { status: "pass", details: "0 errors" } } }}
      />,
    );
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 errors")).toBeDefined();
  });

  it("renders a failing check with the failure styling", () => {
    const { container } = render(
      <ExecutionReportView
        report={{ checks: { tests: { status: "fail", details: "2 failed" } } }}
      />,
    );
    expect(container.querySelector(".border-state-blocked\\/30")).not.toBeNull();
  });

  it("renders a pending/unknown-status check with the neutral styling", () => {
    const { container } = render(
      <ExecutionReportView
        report={{ checks: { typecheck: { status: "pending", details: "running" } } }}
      />,
    );
    expect(container.querySelector(".border-border-subtle")).not.toBeNull();
    expect(screen.getByText("typecheck")).toBeDefined();
  });

  it("renders the list of changed files with a count heading", () => {
    render(<ExecutionReportView report={{ filesChanged: ["a.ts", "b.ts"] }} />);
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("a.ts")).toBeDefined();
    expect(screen.getByText("b.ts")).toBeDefined();
  });

  it("renders notes via Markdown", () => {
    render(<ExecutionReportView report={{ notes: ["Watch the migration"] }} />);
    expect(screen.getByTestId("md").textContent).toBe("Watch the migration");
  });

  it("shows 'Created' when prDraftCreated is true and 'Not created' when false", () => {
    const { rerender } = render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft: Created/)).toBeDefined();

    rerender(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft: Not created/)).toBeDefined();
  });

  it("does not render the PR draft line when the field is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });
});
