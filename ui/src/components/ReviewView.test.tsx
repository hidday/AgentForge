import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing distinctive for an empty review", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(screen.queryByText("Verdict:")).toBeNull();
    expect(container.querySelector(".space-y-4")).not.toBeNull();
  });

  it("renders an approved verdict with done styling", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Verdict:")).toBeDefined();
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("text-state-done");
  });

  it("renders a changes-requested verdict for any non-approved value", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("text-state-blocked");
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Overall looks solid." }} />);
    expect(screen.getByText("Overall looks solid.")).toBeDefined();
  });

  it("does not render a summary paragraph when absent", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.querySelector("p.text-sm.text-text-secondary")).toBeNull();
  });

  it("renders findings with severity badge, title, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "This will throw on undefined input.",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("This will throw on undefined input.")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("renders a finding's affected step id when file is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f2",
              severity: "nit",
              title: "Style nit",
              details: "Prefer const.",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("omits the file/step line entirely when neither is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f3",
              severity: "suggestion",
              title: "Consider renaming",
              details: "Clearer naming would help.",
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/)).toBeNull();
  });

  it("falls back to the nit style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f4",
              severity: "unknown-severity",
              title: "Weird one",
              details: "details",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("unknown-severity");
    expect(badge.className).toContain("severity-nit");
  });

  it.each(["blocker", "important", "suggestion", "nit"])(
    "applies the matching severity style class for %s",
    (severity) => {
      render(
        <ReviewView
          review={{
            findings: [
              { id: `f-${severity}`, severity, title: "T", details: "D" },
            ],
          }}
        />,
      );
      const badge = screen.getByText(severity);
      expect(badge.className).toContain(`severity-${severity}`);
    },
  );

  it("does not render the findings section when findings is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });
});
