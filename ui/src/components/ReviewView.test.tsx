import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra for a bare payload with no verdict, summary, or findings", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.querySelector(".space-y-4")).not.toBeNull();
    expect(screen.queryByText(/Verdict:/)).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders the Approved verdict badge with done styling", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Verdict:")).toBeDefined();
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("state-done");
  });

  it("renders the Changes Requested verdict badge with blocked styling", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("state-blocked");
  });

  it("renders the summary text", () => {
    render(
      <ReviewView
        review={{ overallVerdict: "approved", summary: "Looks solid overall." }}
      />,
    );
    expect(screen.getByText("Looks solid overall.")).toBeDefined();
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
              details: "This will throw if input is undefined.",
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
    expect(
      screen.getByText("This will throw if input is undefined."),
    ).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("renders affectedStepId when file is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "Style nit",
              details: "Prefer const over let.",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("falls back to the nit severity style for an unrecognized severity value", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "unknown-severity",
              title: "Odd finding",
              details: "details",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("unknown-severity");
    expect(badge.className).toContain("severity-nit");
  });

  it("renders multiple findings with distinct severities", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "important", title: "Issue A", details: "A" },
            { id: "f2", severity: "suggestion", title: "Issue B", details: "B" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("Issue A")).toBeDefined();
    expect(screen.getByText("Issue B")).toBeDefined();
    expect(screen.getByText("important")).toBeDefined();
    expect(screen.getByText("suggestion")).toBeDefined();
  });
});
