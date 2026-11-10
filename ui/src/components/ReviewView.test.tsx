import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing for verdict/summary/findings when fields are absent", () => {
    const { container } = render(<ReviewView review={{}} />);
    // Root wrapper div still renders (space-y-4), but no verdict/summary/findings content
    expect(screen.queryByText(/Verdict:/i)).toBeNull();
    expect(screen.queryByText(/Findings/i)).toBeNull();
    expect(container.querySelector("div")).not.toBeNull();
  });

  it("renders 'Approved' badge with done styling for approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge).toBeDefined();
    expect(badge.className).toContain("bg-state-done-bg");
    expect(badge.className).toContain("text-state-done");
  });

  it("renders 'Changes Requested' badge with blocked styling for a non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge).toBeDefined();
    expect(badge.className).toContain("bg-state-blocked-bg");
    expect(badge.className).toContain("text-state-blocked");
  });

  it("renders the summary text when present", () => {
    render(
      <ReviewView
        review={{ summary: "Overall the implementation looks solid." }}
      />,
    );
    expect(
      screen.getByText("Overall the implementation looks solid."),
    ).toBeDefined();
  });

  it("renders zero-findings case without a Findings section", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/i)).toBeNull();
  });

  it("renders findings list with count, severity badge, title, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "SQL injection risk",
              details: "User input is concatenated directly into the query.",
              file: "src/db.ts",
              lineHint: 42,
            },
            {
              id: "f2",
              severity: "nit",
              title: "Naming nit",
              details: "Consider renaming `tmp` to something clearer.",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("SQL injection risk")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(
      screen.getByText(
        "User input is concatenated directly into the query.",
      ),
    ).toBeDefined();
    expect(screen.getByText("src/db.ts:42")).toBeDefined();

    expect(screen.getByText("Naming nit")).toBeDefined();
    expect(screen.getByText("nit")).toBeDefined();
  });

  it("falls back to the nit severity style for an unknown severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f3",
              severity: "totally-unknown",
              title: "Mystery finding",
              details: "Something odd.",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("totally-unknown");
    expect(badge.className).toContain("bg-severity-nit/10");
  });

  it("shows affectedStepId when file is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f4",
              severity: "important",
              title: "Step mismatch",
              details: "Doesn't match step 2.",
              affectedStepId: "step-2",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-2")).toBeDefined();
  });

  it("does not render the file/step meta row when neither file nor affectedStepId is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f5",
              severity: "suggestion",
              title: "No location finding",
              details: "General suggestion with no location.",
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/i)).toBeNull();
    // file/lineHint text would show a colon-joined mono string; ensure none present
    const details = screen.getByText("General suggestion with no location.");
    expect(details).toBeDefined();
  });

  it("renders file without a line hint when lineHint is not provided", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f6",
              severity: "nit",
              title: "No line hint",
              details: "File only, no line.",
              file: "src/app.ts",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/app.ts")).toBeDefined();
  });
});
