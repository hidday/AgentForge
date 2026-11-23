import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing for verdict/summary/findings when the review object is empty", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText("Verdict:")).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("shows 'Approved' styling and label when overallVerdict is approved", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
  });

  it("shows 'Changes Requested' styling and label for a non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Looks mostly good." }} />);
    expect(screen.getByText("Looks mostly good.")).toBeDefined();
  });

  it("renders a findings count heading and each finding's title, severity and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Null deref",
              details: "Will crash on empty input",
              file: "src/foo.ts",
              lineHint: 42,
            },
            {
              id: "f2",
              severity: "nit",
              title: "Naming",
              details: "Prefer camelCase",
              affectedStepId: "step-2",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("Null deref")).toBeDefined();
    expect(screen.getByText("Will crash on empty input")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
    expect(screen.getByText("Step: step-2")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("nit")).toBeDefined();
  });

  it("falls back to the nit severity style for an unknown severity value", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "unknown-severity",
              title: "Weird",
              details: "d",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("unknown-severity");
    expect(badge.className).toContain("bg-severity-nit/10");
  });

  it("does not render a file/line block when neither file nor affectedStepId is present", () => {
    render(
      <ReviewView
        review={{
          findings: [{ id: "f1", severity: "nit", title: "T", details: "D" }],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/)).toBeNull();
  });
});
