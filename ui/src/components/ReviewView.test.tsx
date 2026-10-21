import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing when the review has no fields", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.querySelector("span")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });

  it("shows an Approved badge for an approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
  });

  it("shows a Changes Requested badge for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Looks mostly good." }} />);
    expect(screen.getByText("Looks mostly good.")).toBeDefined();
  });

  it("renders findings with count, severity badge, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Null pointer risk",
              details: "This will crash on empty input.",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Null pointer risk")).toBeDefined();
    expect(screen.getByText("This will crash on empty input.")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("renders the affected step id when present instead of a file", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f2",
              severity: "nit",
              title: "Minor nit",
              details: "Consider renaming.",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("does not render file/step metadata line when neither is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f3",
              severity: "suggestion",
              title: "Suggestion",
              details: "Just a thought.",
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/^Step:/)).toBeNull();
  });

  it("falls back to the nit style for an unknown severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f4",
              severity: "unknown-severity",
              title: "Weird severity",
              details: "Details here.",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("unknown-severity");
    expect(badge.className).toContain("severity-nit");
  });

  it("does not render a Findings section when findings is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/^Findings/)).toBeNull();
  });

  it("renders a file without a line hint correctly", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f5",
              severity: "important",
              title: "No line hint",
              details: "Details.",
              file: "src/bar.ts",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/bar.ts")).toBeDefined();
  });
});
