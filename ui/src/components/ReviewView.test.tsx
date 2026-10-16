import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing for a completely empty review", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText(/Verdict:/)).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  describe("verdict", () => {
    it("renders 'Approved' with done styling when overallVerdict is 'approved'", () => {
      render(<ReviewView review={{ overallVerdict: "approved" }} />);
      expect(screen.getByText("Verdict:")).toBeDefined();
      const badge = screen.getByText("Approved");
      expect(badge).toBeDefined();
      expect(badge.className).toContain("bg-state-done-bg");
      expect(badge.className).toContain("text-state-done");
    });

    it("renders 'Changes Requested' with blocked styling for any non-approved verdict", () => {
      render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
      const badge = screen.getByText("Changes Requested");
      expect(badge).toBeDefined();
      expect(badge.className).toContain("bg-state-blocked-bg");
      expect(badge.className).toContain("text-state-blocked");
    });

    it("omits the verdict row when overallVerdict is absent", () => {
      render(<ReviewView review={{ summary: "hi" }} />);
      expect(screen.queryByText(/Verdict:/)).toBeNull();
    });
  });

  describe("summary", () => {
    it("renders the summary text when present", () => {
      render(<ReviewView review={{ summary: "Looks good overall." }} />);
      expect(screen.getByText("Looks good overall.")).toBeDefined();
    });

    it("omits the summary paragraph when absent", () => {
      const { container } = render(<ReviewView review={{}} />);
      expect(container.querySelector("p")).toBeNull();
    });
  });

  describe("findings", () => {
    it("omits the Findings section when findings is empty", () => {
      render(<ReviewView review={{ findings: [] }} />);
      expect(screen.queryByText(/Findings/)).toBeNull();
    });

    it("renders the Findings heading with the correct count", () => {
      render(
        <ReviewView
          review={{
            findings: [
              { id: "f1", severity: "blocker", title: "Bug A", details: "Details A" },
              { id: "f2", severity: "nit", title: "Bug B", details: "Details B" },
            ],
          }}
        />,
      );
      expect(screen.getByText("Findings (2)")).toBeDefined();
    });

    it("renders each finding's severity, title, and details", () => {
      render(
        <ReviewView
          review={{
            findings: [
              {
                id: "f1",
                severity: "important",
                title: "Missing null check",
                details: "This could throw at runtime.",
              },
            ],
          }}
        />,
      );
      expect(screen.getByText("important")).toBeDefined();
      expect(screen.getByText("Missing null check")).toBeDefined();
      expect(screen.getByText("This could throw at runtime.")).toBeDefined();
    });

    it("applies the blocker severity style classes", () => {
      render(
        <ReviewView
          review={{
            findings: [
              { id: "f1", severity: "blocker", title: "Critical bug", details: "Fails tests" },
            ],
          }}
        />,
      );
      const severityBadge = screen.getByText("blocker");
      expect(severityBadge.className).toContain("text-severity-blocker");
    });

    it("falls back to the nit style for an unrecognized severity value", () => {
      render(
        <ReviewView
          review={{
            findings: [
              { id: "f1", severity: "mystery", title: "Weird finding", details: "???" },
            ],
          }}
        />,
      );
      const severityBadge = screen.getByText("mystery");
      expect(severityBadge.className).toContain("text-severity-nit");
    });

    it("renders file and lineHint together when both are present", () => {
      const { container } = render(
        <ReviewView
          review={{
            findings: [
              {
                id: "f1",
                severity: "suggestion",
                title: "Style nit",
                details: "Consider renaming",
                file: "src/foo.ts",
                lineHint: 42,
              },
            ],
          }}
        />,
      );
      const metaSpan = container.querySelector(".font-mono.text-text-muted span");
      expect(metaSpan?.textContent).toBe("src/foo.ts:42");
    });

    it("renders the file without a line suffix when lineHint is absent", () => {
      const { container } = render(
        <ReviewView
          review={{
            findings: [
              {
                id: "f1",
                severity: "suggestion",
                title: "Style nit",
                details: "Consider renaming",
                file: "src/foo.ts",
              },
            ],
          }}
        />,
      );
      const metaSpan = container.querySelector(".font-mono.text-text-muted span");
      expect(metaSpan?.textContent).toBe("src/foo.ts");
    });

    it("renders the affected step id when present", () => {
      render(
        <ReviewView
          review={{
            findings: [
              {
                id: "f1",
                severity: "nit",
                title: "Plan deviation",
                details: "Step differs from plan",
                affectedStepId: "step-3",
              },
            ],
          }}
        />,
      );
      expect(screen.getByText("Step: step-3")).toBeDefined();
    });

    it("omits the file/step metadata row entirely when neither file nor affectedStepId is set", () => {
      render(
        <ReviewView
          review={{
            findings: [
              { id: "f1", severity: "nit", title: "No metadata", details: "Just details" },
            ],
          }}
        />,
      );
      expect(screen.queryByText(/Step:/)).toBeNull();
    });

    it("renders multiple findings independently", () => {
      render(
        <ReviewView
          review={{
            findings: [
              { id: "f1", severity: "blocker", title: "First finding", details: "D1" },
              { id: "f2", severity: "suggestion", title: "Second finding", details: "D2" },
            ],
          }}
        />,
      );
      expect(screen.getByText("First finding")).toBeDefined();
      expect(screen.getByText("Second finding")).toBeDefined();
      expect(screen.getByText("D1")).toBeDefined();
      expect(screen.getByText("D2")).toBeDefined();
    });
  });

  it("renders a fully populated review with verdict, summary, and findings together", () => {
    render(
      <ReviewView
        review={{
          overallVerdict: "approved",
          summary: "All checks pass.",
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "Minor nit",
              details: "Consider a comment here.",
              file: "src/bar.ts",
              lineHint: 10,
              affectedStepId: "step-1",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Approved")).toBeDefined();
    expect(screen.getByText("All checks pass.")).toBeDefined();
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("Minor nit")).toBeDefined();
    expect(screen.getByText("Consider a comment here.")).toBeDefined();
    expect(screen.getByText("Step: step-1")).toBeDefined();
  });
});
