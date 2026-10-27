import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing meaningful when the review payload is empty", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.textContent).toBe("");
  });

  it("renders an 'Approved' verdict badge", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("renders a 'Changes Requested' verdict badge for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    expect(screen.getByText("Changes Requested")).toBeDefined();
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "This change looks solid overall." }} />);
    expect(screen.getByText("This change looks solid overall.")).toBeDefined();
  });

  it("renders findings with severity, title, file, line hint and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              file: "src/foo.ts",
              lineHint: 42,
              title: "Missing null check",
              details: "This can throw at runtime.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
    expect(screen.getByText("This can throw at runtime.")).toBeDefined();
  });

  it("renders affectedStepId when file is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f2",
              severity: "nit",
              affectedStepId: "step-3",
              title: "Minor style issue",
              details: "Consider renaming.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("falls back to the 'nit' severity style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f3",
              severity: "totally-unknown",
              title: "Odd finding",
              details: "Details here.",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("totally-unknown");
    expect(badge.className).toContain("severity-nit");
  });

  it("omits the file/step line entirely when neither is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f4",
              severity: "suggestion",
              title: "No location",
              details: "Just a note.",
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/)).toBeNull();
  });

  it("does not render a Findings section when findings is empty", () => {
    render(<ReviewView review={{ summary: "ok", findings: [] }} />);
    expect(screen.queryByText(/^Findings/)).toBeNull();
  });
});
