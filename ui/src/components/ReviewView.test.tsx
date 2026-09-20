import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra when review is an empty object", () => {
    const { container } = render(<ReviewView review={{}} />);
    // Root div renders but with no children content.
    expect(container.textContent).toBe("");
  });

  it("shows 'Approved' badge with done styling when verdict is approved", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
  });

  it("shows 'Changes Requested' badge with blocked styling for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Looks solid overall." }} />);
    expect(screen.getByText("Looks solid overall.")).toBeDefined();
  });

  it("renders findings with severity badge, title, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "SQL injection risk",
              details: "User input is concatenated directly into the query.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("SQL injection risk")).toBeDefined();
    expect(
      screen.getByText("User input is concatenated directly into the query."),
    ).toBeDefined();
  });

  it("falls back to the 'nit' severity style for an unrecognized severity value", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "weird-severity", title: "T", details: "D" },
          ],
        }}
      />,
    );
    const badge = screen.getByText("weird-severity");
    expect(badge.className).toContain("severity-nit");
  });

  it("shows the file path and line hint when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "T",
              details: "D",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("shows the affected step id when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "T",
              details: "D",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("does not render the file/step metadata row when neither is present", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [{ id: "f1", severity: "nit", title: "T", details: "D" }],
        }}
      />,
    );
    expect(container.querySelector(".font-mono.text-text-muted")).toBeNull();
  });

  it("does not render the findings section when findings is empty or absent", () => {
    render(<ReviewView review={{ summary: "ok" }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });
});
