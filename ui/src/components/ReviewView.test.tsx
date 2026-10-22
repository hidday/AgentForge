import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing meaningful for an empty payload", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.textContent).toBe("");
  });

  it("renders an approved verdict with the done styling", () => {
    const { container } = render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Approved")).toBeDefined();
    const badge = container.querySelector(".bg-state-done-bg");
    expect(badge).not.toBeNull();
  });

  it("renders a non-approved verdict as 'Changes Requested' with the blocked styling", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "changes_requested" }} />,
    );
    expect(screen.getByText("Changes Requested")).toBeDefined();
    const badge = container.querySelector(".bg-state-blocked-bg");
    expect(badge).not.toBeNull();
  });

  it("renders the summary text", () => {
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
              title: "Missing null check",
              details: "Could throw on empty input.",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("Could throw on empty input.")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("renders the affectedStepId when file is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f2",
              severity: "nit",
              title: "Style nit",
              details: "Prefer const.",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("falls back to the nit style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f3", severity: "weird-severity", title: "Edge case", details: "x" },
          ],
        }}
      />,
    );
    expect(screen.getByText("weird-severity")).toBeDefined();
  });
});
