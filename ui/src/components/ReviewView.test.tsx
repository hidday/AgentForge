import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing meaningful for an empty review", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(screen.queryByText(/Verdict/)).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("shows an Approved verdict and summary", () => {
    render(<ReviewView review={{ overallVerdict: "approved", summary: "Looks good" }} />);
    const verdict = screen.getByText("Approved");
    expect(verdict.className).toContain("text-state-done");
    expect(screen.getByText("Looks good")).toBeTruthy();
  });

  it("shows Changes Requested for any non-approved verdict and lists findings", () => {
    render(
      <ReviewView
        review={{
          overallVerdict: "changes_requested",
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Null deref",
              details: "x may be null",
              file: "src/a.ts",
              lineHint: 42,
            },
            {
              id: "f2",
              severity: "weird",
              title: "Step issue",
              details: "missing tests",
              affectedStepId: "step-3",
            },
            { id: "f3", severity: "nit", title: "File only", details: "d", file: "b.ts" },
            { id: "f4", severity: "suggestion", title: "Bare", details: "no location" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Changes Requested").className).toContain("text-state-blocked");
    expect(screen.getByText("Findings (4)")).toBeTruthy();
    expect(screen.getByText("src/a.ts:42")).toBeTruthy();
    expect(screen.getByText("Step: step-3")).toBeTruthy();
    expect(screen.getByText("b.ts")).toBeTruthy();
    expect(screen.getByText("blocker").className).toContain("text-severity-blocker");
    // unknown severity falls back to nit styling
    expect(screen.getByText("weird").className).toContain("text-severity-nit");
    expect(screen.getByText("no location").previousElementSibling?.className).toContain("flex");
  });
});
