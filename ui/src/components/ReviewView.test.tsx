import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra when review has no verdict, summary, or findings", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText(/verdict/i)).toBeNull();
    expect(screen.queryByText(/findings/i)).toBeNull();
  });

  it("shows 'Approved' styling for an approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
  });

  it("shows 'Changes Requested' for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Looks mostly good." }} />);
    expect(screen.getByText("Looks mostly good.")).toBeDefined();
  });

  it("renders findings with severity, title, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "This will throw on empty input.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("This will throw on empty input.")).toBeDefined();
  });

  it("falls back to the 'nit' style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "weird-severity",
              title: "Odd finding",
              details: "details",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("weird-severity");
    expect(badge.className).toContain("severity-nit");
  });

  it("renders the file path and line hint when file is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "Style nit",
              details: "d",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("renders the file path without a line suffix when lineHint is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "Style nit",
              details: "d",
              file: "src/foo.ts",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts")).toBeDefined();
  });

  it("renders the affected step id when present instead of/alongside file", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Plan mismatch",
              details: "d",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("does not render the metadata row when neither file nor affectedStepId is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "suggestion", title: "T", details: "d" },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/)).toBeNull();
  });
});
