import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders an approved verdict with done styling and no findings section", () => {
    render(
      <ReviewView
        review={{
          overallVerdict: "approved",
          summary: "Looks solid.",
          findings: [],
        }}
      />,
    );

    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("state-done");
    expect(screen.getByText("Looks solid.")).toBeDefined();
    expect(screen.queryByText(/^Findings/)).toBeNull();
  });

  it("renders a changes-requested verdict with blocked styling and findings", () => {
    render(
      <ReviewView
        review={{
          overallVerdict: "changes_requested",
          summary: "Needs work.",
          findings: [
            {
              id: "f1",
              severity: "blocker",
              file: "src/foo.ts",
              lineHint: 42,
              title: "Missing null check",
              details: "This can throw at runtime.",
            },
            {
              id: "f2",
              severity: "nit",
              affectedStepId: "step-2",
              title: "Style nit",
              details: "Rename variable.",
            },
          ],
        }}
      />,
    );

    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("state-blocked");
    expect(screen.getByText("Needs work.")).toBeDefined();

    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
    expect(screen.getByText("This can throw at runtime.")).toBeDefined();

    expect(screen.getByText("Style nit")).toBeDefined();
    expect(screen.getByText("Step: step-2")).toBeDefined();

    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("nit")).toBeDefined();
  });

  it("falls back to nit severity styling for an unrecognized severity value", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "mystery",
              title: "Odd finding",
              details: "n/a",
            },
          ],
        }}
      />,
    );

    const severityBadge = screen.getByText("mystery");
    expect(severityBadge.className).toContain("severity-nit");
  });

  it("renders nothing meaningful for an empty/missing review", () => {
    const { container } = render(<ReviewView review={{}} />);

    expect(screen.queryByText(/Verdict/)).toBeNull();
    expect(screen.queryByText(/^Findings/)).toBeNull();
    expect(container.querySelector(".space-y-4")).not.toBeNull();
    expect(container.textContent).toBe("");
  });
});
