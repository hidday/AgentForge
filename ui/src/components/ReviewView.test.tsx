import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing distinctive for a completely empty review", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText("Verdict:")).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders an Approved verdict badge", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Verdict:")).toBeDefined();
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("renders a Changes Requested verdict badge for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    expect(screen.getByText("Changes Requested")).toBeDefined();
  });

  it("applies done styling to the approved badge and blocked styling to changes requested", () => {
    const { container: approvedContainer } = render(
      <ReviewView review={{ overallVerdict: "approved" }} />,
    );
    expect(approvedContainer.querySelector(".bg-state-done-bg")).not.toBeNull();

    const { container: changesContainer } = render(
      <ReviewView review={{ overallVerdict: "changes_requested" }} />,
    );
    expect(changesContainer.querySelector(".bg-state-blocked-bg")).not.toBeNull();
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Looks mostly good." }} />);
    expect(screen.getByText("Looks mostly good.")).toBeDefined();
  });

  it("renders the findings count and each finding's severity, title, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "This will throw at runtime.",
            },
            {
              id: "f2",
              severity: "nit",
              title: "Naming nit",
              details: "Consider renaming.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("This will throw at runtime.")).toBeDefined();
    expect(screen.getByText("nit")).toBeDefined();
  });

  it("falls back to the nit severity style for an unrecognized severity value", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "unknown-severity",
              title: "Weird finding",
              details: "Details",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("unknown-severity");
    expect(badge.className).toContain("severity-nit");
    expect(container).toBeDefined();
  });

  it("renders file and line hint information when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Bug",
              details: "Details",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("renders the affected step id when present without a file", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "Consider refactor",
              details: "Details",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("does not render the file/step metadata row when neither is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "Simple nit",
              details: "Details",
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/^src\//)).toBeNull();
    expect(screen.queryByText(/^Step:/)).toBeNull();
  });

  it("does not render a Findings section when findings is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });
});
