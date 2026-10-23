import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing for verdict/summary/findings when the review object is empty", () => {
    const { container } = render(<ReviewView review={{}} />);
    // No verdict label, no findings heading — container should be effectively empty.
    expect(screen.queryByText(/Verdict:/i)).toBeNull();
    expect(screen.queryByText(/Findings/i)).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders an 'Approved' badge with done styling when overallVerdict is approved", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("state-done");
  });

  it("renders a 'Changes Requested' badge with blocked styling for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("state-blocked");
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Looks solid overall." }} />);
    expect(screen.getByText("Looks solid overall.")).toBeDefined();
  });

  it("renders findings count heading and each finding's severity/title/details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "Could throw on empty input.",
              file: "src/foo.ts",
              lineHint: 42,
            },
            {
              id: "f2",
              severity: "nit",
              title: "Naming",
              details: "Prefer camelCase.",
              affectedStepId: "step-2",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("Could throw on empty input.")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();

    expect(screen.getByText("nit")).toBeDefined();
    expect(screen.getByText("Step: step-2")).toBeDefined();
  });

  it("falls back to the 'nit' severity style for an unrecognized severity value", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "unknown-severity",
              title: "Odd finding",
              details: "details",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("unknown-severity");
    // Falls back to SEVERITY_STYLES.nit classes.
    expect(badge.className).toContain("severity-nit");
  });

  it("does not render a findings section when findings array is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/i)).toBeNull();
  });

  it("omits the file/step metadata row when neither file nor affectedStepId is set", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "suggestion", title: "T", details: "D" },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/)).toBeNull();
    // file/lineHint block absent too — no colon-prefixed line marker
    expect(screen.queryByText(/:\d+$/)).toBeNull();
  });
});
