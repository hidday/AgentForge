import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra when review has no verdict, summary, or findings", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(screen.queryByText(/Verdict:/i)).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("shows an Approved badge with done styling for an approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
  });

  it("shows a Changes Requested badge for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Looks solid overall." }} />);
    expect(screen.getByText("Looks solid overall.")).toBeDefined();
  });

  it("does not render a findings section when findings is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/i)).toBeNull();
  });

  it("renders findings with severity, title, details, file, line, and step metadata", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "This could throw.",
              file: "src/index.ts",
              lineHint: 42,
            },
            {
              id: "f2",
              severity: "suggestion",
              title: "Consider renaming",
              details: "Clearer naming would help.",
              affectedStepId: "step-2",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("This could throw.")).toBeDefined();
    expect(screen.getByText("src/index.ts:42")).toBeDefined();

    expect(screen.getByText("suggestion")).toBeDefined();
    expect(screen.getByText("Step: step-2")).toBeDefined();
  });

  it("falls back to the nit severity style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "mystery",
              title: "Odd finding",
              details: "Unclear severity.",
            },
          ],
        }}
      />,
    );

    const badge = screen.getByText("mystery");
    expect(badge.className).toContain("bg-severity-nit/10");
  });

  it("renders a file without a lineHint without appending a colon-number suffix", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "Style nit",
              details: "Minor.",
              file: "src/App.tsx",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("src/App.tsx")).toBeDefined();
  });
});
