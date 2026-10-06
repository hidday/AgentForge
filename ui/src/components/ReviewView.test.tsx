import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing but an empty container when review has no recognized fields", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.querySelector(".space-y-4")).not.toBeNull();
    expect(screen.queryByText("Verdict:")).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders 'Approved' verdict styling for an approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Verdict:")).toBeDefined();
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("text-state-done");
  });

  it("renders 'Changes Requested' for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "rejected" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("text-state-blocked");
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Looks solid overall." }} />);
    expect(screen.getByText("Looks solid overall.")).toBeDefined();
  });

  it("renders findings count and each finding's severity, title, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "This will throw on null input.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("This will throw on null input.")).toBeDefined();
  });

  it("falls back to the 'nit' severity style for an unknown severity value", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "weird-severity",
              title: "Odd finding",
              details: "Detail text",
            },
          ],
        }}
      />,
    );
    const severityBadge = screen.getByText("weird-severity");
    expect(severityBadge.className).toContain("severity-nit");
  });

  it("renders file and lineHint when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Bad formatting",
              details: "Detail text",
              file: "src/index.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/index.ts:42")).toBeDefined();
  });

  it("renders affectedStepId when present instead of/alongside file", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "Consider refactor",
              details: "Detail text",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("does not render the file/step metadata row when neither file nor affectedStepId is present", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "Minor",
              details: "Detail text",
            },
          ],
        }}
      />,
    );
    expect(container.querySelector(".font-mono.text-text-muted")).toBeNull();
  });

  it("renders an empty findings list without the Findings section", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });
});
