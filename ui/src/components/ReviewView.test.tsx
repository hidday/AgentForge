import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders the 'Approved' verdict distinctly", () => {
    render(<ReviewView review={{ overallVerdict: "approved", summary: "Looks good." }} />);
    expect(screen.getByText("Approved")).toBeDefined();
    expect(screen.getByText("Looks good.")).toBeDefined();
  });

  it("renders the 'Changes Requested' verdict for any non-approved verdict value", () => {
    render(
      <ReviewView
        review={{ overallVerdict: "changes_requested", summary: "Needs work." }}
      />,
    );
    expect(screen.getByText("Changes Requested")).toBeDefined();
  });

  it("renders findings with severity, title, file/line, step, and details", () => {
    const review = {
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          title: "Missing null check",
          file: "src/foo.ts",
          lineHint: 42,
          details: "This will throw at runtime.",
        },
        {
          id: "f2",
          severity: "nit",
          title: "Naming convention",
          affectedStepId: "s2",
          details: "Prefer camelCase.",
        },
      ],
    };
    render(<ReviewView review={review} />);

    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
    expect(screen.getByText("This will throw at runtime.")).toBeDefined();

    expect(screen.getByText("nit")).toBeDefined();
    expect(screen.getByText("Naming convention")).toBeDefined();
    expect(screen.getByText("Step: s2")).toBeDefined();
    expect(screen.getByText("Prefer camelCase.")).toBeDefined();
  });

  it("renders no findings section when findings is an empty array", () => {
    render(<ReviewView review={{ overallVerdict: "approved", findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders nothing for verdict/summary when they are absent", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText("Approved")).toBeNull();
    expect(screen.queryByText("Changes Requested")).toBeNull();
    expect(screen.queryByText(/Verdict:/)).toBeNull();
  });
});
