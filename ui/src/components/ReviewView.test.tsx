import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("shows 'Approved' styling and text for an approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("state-done");
  });

  it("shows 'Changes Requested' styling for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("state-blocked");
  });

  it("does not render a verdict row when none is given", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText("Verdict:")).toBeNull();
  });

  it("renders the review summary text", () => {
    render(<ReviewView review={{ summary: "Looks mostly good" }} />);
    expect(screen.getByText("Looks mostly good")).toBeDefined();
  });

  it("renders findings with severity badge, title, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "SQL injection risk",
              details: "Unescaped user input in query",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("SQL injection risk")).toBeDefined();
    expect(screen.getByText("Unescaped user input in query")).toBeDefined();
  });

  it("shows the file and line hint when present on a finding", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "x",
              details: "y",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("shows the affected step id when a finding references a plan step", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "nit", title: "x", details: "y", affectedStepId: "s2" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: s2")).toBeDefined();
  });

  it("falls back to the 'nit' style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "weird-severity", title: "x", details: "y" },
          ],
        }}
      />,
    );
    const badge = screen.getByText("weird-severity");
    expect(badge.className).toContain("severity-nit");
  });

  it("does not render a Findings heading when there are none", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });
});
