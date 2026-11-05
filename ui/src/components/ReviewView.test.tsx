import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra when review has no verdict, summary, or findings", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.querySelector(".space-y-4")?.children.length).toBe(0);
  });

  it("renders an 'Approved' verdict badge with done styling", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("state-done");
  });

  it("renders a 'Changes Requested' verdict badge for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("state-blocked");
  });

  it("renders the summary text when provided", () => {
    render(<ReviewView review={{ summary: "Looks solid overall." }} />);
    expect(screen.getByText("Looks solid overall.")).toBeDefined();
  });

  it("does not render a findings section when findings is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders findings with severity badge, title, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Null pointer risk",
              details: "This will throw at runtime.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Null pointer risk")).toBeDefined();
    expect(screen.getByText("This will throw at runtime.")).toBeDefined();
  });

  it("falls back to the 'nit' severity style for an unrecognized severity value", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "totally-unknown",
              title: "Edge case",
              details: "details",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("totally-unknown");
    expect(badge.className).toContain("severity-nit");
  });

  it("renders the file and line hint when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Issue",
              details: "details",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/src\/foo\.ts:42/)).toBeDefined();
  });

  it("renders the file without a line suffix when lineHint is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Issue",
              details: "details",
              file: "src/foo.ts",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts")).toBeDefined();
  });

  it("renders the affected step id when present and no file is given", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "Issue",
              details: "details",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/Step: step-3/)).toBeDefined();
  });

  it("renders multiple findings in order", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "blocker", title: "First", details: "d1" },
            { id: "f2", severity: "nit", title: "Second", details: "d2" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("First")).toBeDefined();
    expect(screen.getByText("Second")).toBeDefined();
  });
});
