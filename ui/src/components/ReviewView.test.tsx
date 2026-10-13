import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing but the wrapper when the review is empty", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.textContent).toBe("");
  });

  it("shows 'Approved' styling and label for an approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const label = screen.getByText("Approved");
    expect(label).toBeDefined();
    expect(label.className).toContain("text-state-done");
  });

  it("shows 'Changes Requested' label for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "rejected" }} />);
    const label = screen.getByText("Changes Requested");
    expect(label).toBeDefined();
    expect(label.className).toContain("text-state-blocked");
  });

  it("does not render a verdict row when overallVerdict is absent", () => {
    render(<ReviewView review={{ summary: "just a summary" }} />);
    expect(screen.queryByText(/Verdict:/)).toBeNull();
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Overall looks solid." }} />);
    expect(screen.getByText("Overall looks solid.")).toBeDefined();
  });

  it("renders the findings count heading and each finding's title/details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "Will throw at runtime.",
            },
            {
              id: "f2",
              severity: "nit",
              title: "Rename variable",
              details: "Prefer a clearer name.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("Will throw at runtime.")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Rename variable")).toBeDefined();
  });

  it("falls back to the 'nit' severity style for an unrecognized severity", () => {
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
    expect(badge.className).toContain("text-severity-nit");
  });

  it("shows the file path and line hint when provided", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Bug",
              details: "d",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/src\/foo\.ts/)).toBeDefined();
    expect(screen.getByText(/:42/)).toBeDefined();
  });

  it("shows the affected step id when provided and no file/lineHint info line otherwise", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "Consider refactor",
              details: "d",
              affectedStepId: "step-2",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/Step: step-2/)).toBeDefined();
  });

  it("does not render the Findings section when findings is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });
});
