import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing meaningful for an empty review object", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText(/Verdict/)).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders 'Approved' badge with done styling for approved verdict", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "approved" }} />,
    );
    expect(screen.getByText("Verdict:")).toBeDefined();
    const badge = screen.getByText("Approved");
    expect(badge).toBeDefined();
    expect(badge.className).toContain("bg-state-done-bg");
    expect(container.textContent).not.toContain("Changes Requested");
  });

  it("renders 'Changes Requested' badge with blocked styling for a non-approved verdict", () => {
    const badge = render(
      <ReviewView review={{ overallVerdict: "changes_requested" }} />,
    ).getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
  });

  it("does not render verdict row when overallVerdict is absent", () => {
    render(<ReviewView review={{ summary: "no verdict here" }} />);
    expect(screen.queryByText("Verdict:")).toBeNull();
  });

  it("renders summary text when present", () => {
    render(<ReviewView review={{ summary: "Overall looks solid." }} />);
    expect(screen.getByText("Overall looks solid.")).toBeDefined();
  });

  it("does not render summary paragraph when absent", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("renders findings with severity, title, details, file, line hint, and step id", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "This will throw at runtime.",
              file: "src/foo.ts",
              lineHint: 42,
              affectedStepId: "step-1",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("This will throw at runtime.")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
    expect(screen.getByText("Step: step-1")).toBeDefined();
  });

  it("falls back to the nit style for an unrecognized severity value", () => {
    render(
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
    expect(badge.className).toContain("bg-severity-nit/10");
  });

  it("omits the file/step meta row when neither file nor affectedStepId is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "Style nit",
              details: "minor",
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/)).toBeNull();
  });

  it("renders file without a line number when lineHint is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "No line",
              details: "d",
              file: "src/bar.ts",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/bar.ts")).toBeDefined();
  });

  it("does not render the Findings section when findings array is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders multiple findings with the correct count", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "blocker", title: "A", details: "a" },
            { id: "f2", severity: "suggestion", title: "B", details: "b" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("A")).toBeDefined();
    expect(screen.getByText("B")).toBeDefined();
  });
});
