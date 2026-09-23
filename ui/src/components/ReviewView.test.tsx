import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra for an empty review object", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText("Verdict:")).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders an 'Approved' badge with done styling for verdict === 'approved'", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Verdict:")).toBeDefined();
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
  });

  it("renders a 'Changes Requested' badge with blocked styling for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Overall looks solid." }} />);
    expect(screen.getByText("Overall looks solid.")).toBeDefined();
  });

  it("does not render a summary paragraph when absent", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("does not render a findings section when findings is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders findings with severity badge, title and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "This could throw at runtime.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("This could throw at runtime.")).toBeDefined();
  });

  it("falls back to the nit severity style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "unknown-severity",
              title: "Something",
              details: "Details",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("unknown-severity");
    expect(badge.className).toContain("severity-nit");
  });

  it("renders file and lineHint together when both are present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "T",
              details: "D",
              file: "src/index.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/index.ts:42")).toBeDefined();
  });

  it("renders the file without a line suffix when lineHint is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "important", title: "T", details: "D", file: "src/a.ts" },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/a.ts")).toBeDefined();
  });

  it("renders the affected step id when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "T",
              details: "D",
              affectedStepId: "step-2",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-2")).toBeDefined();
  });

  it("does not render the file/step meta row when both file and affectedStepId are absent", () => {
    render(
      <ReviewView
        review={{
          findings: [{ id: "f1", severity: "nit", title: "T", details: "D" }],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/)).toBeNull();
  });

  it("renders multiple findings with a correct count", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "blocker", title: "T1", details: "D1" },
            { id: "f2", severity: "nit", title: "T2", details: "D2" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (2)")).toBeDefined();
  });
});
