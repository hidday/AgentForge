import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders an 'Approved' badge with done styling for verdict='approved'", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "approved", findings: [] }} />,
    );
    expect(screen.getByText("Approved")).toBeDefined();
    expect(container.querySelector(".bg-state-done-bg")).not.toBeNull();
  });

  it("renders a 'Changes Requested' badge with blocked styling for any non-approved verdict", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "changes_requested", findings: [] }} />,
    );
    expect(screen.getByText("Changes Requested")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked-bg")).not.toBeNull();
  });

  it("omits the verdict line when overallVerdict is absent", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText("Verdict:")).toBeNull();
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Looks solid overall." }} />);
    expect(screen.getByText("Looks solid overall.")).toBeDefined();
  });

  it("omits the summary paragraph when summary is absent", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("omits the findings section when findings is empty or absent", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders findings count heading and each finding's severity, title and details", () => {
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
            {
              id: "f2",
              severity: "nit",
              title: "Prefer const",
              details: "Use const instead of let here.",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("SQL injection risk")).toBeDefined();
    expect(
      screen.getByText("User input is concatenated directly into the query."),
    ).toBeDefined();
    expect(screen.getByText("nit")).toBeDefined();
    expect(screen.getByText("Prefer const")).toBeDefined();
  });

  it("falls back to the nit style for an unrecognised severity value", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "unknown-severity",
              title: "Weird finding",
              details: "details",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("unknown-severity");
    expect(badge.className).toContain("severity-nit");
    expect(container).toBeDefined();
  });

  it("shows file (with optional lineHint) when a finding has a file", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Off by one",
              details: "loop bound is wrong",
              file: "src/index.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    const matches = screen.getAllByText(
      (_, el) => el?.textContent === "src/index.ts:42",
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].textContent).toBe("src/index.ts:42");
  });

  it("shows the affected step id when present without a file", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "Consider step change",
              details: "details here",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("omits the file/step metadata row when neither file nor affectedStepId is present", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "No location",
              details: "no file or step",
            },
          ],
        }}
      />,
    );
    expect(container.querySelector(".font-mono.text-text-muted")).toBeNull();
  });
});
