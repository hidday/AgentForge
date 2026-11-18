import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing distinctive for an empty review object", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.querySelector("div")).not.toBeNull();
    expect(screen.queryByText("Verdict:")).toBeNull();
  });

  it("renders 'Approved' styling for an approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("renders 'Changes Requested' for a non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    expect(screen.getByText("Changes Requested")).toBeDefined();
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Looks solid overall." }} />);
    expect(screen.getByText("Looks solid overall.")).toBeDefined();
  });

  it("renders findings with severity, title, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "Will throw at runtime.",
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
    expect(screen.getByText("Will throw at runtime.")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("renders affectedStepId when present instead of/with file info", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f2",
              severity: "nit",
              title: "Style nit",
              details: "Minor.",
              affectedStepId: "step-3",
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
              severity: "unknown-severity",
              title: "Weird",
              details: "Details",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("unknown-severity");
    expect(badge.className).toContain("severity-nit");
  });

  it("does not render a file/step line when neither is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f4",
              severity: "suggestion",
              title: "No location",
              details: "Details",
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/)).toBeNull();
  });
});
