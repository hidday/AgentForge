import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing distinctive for an empty review object (no verdict, summary or findings)", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(screen.queryByText(/Verdict:/)).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
    // Outer wrapper still renders (space-y-4 div) but with no content.
    expect(container.querySelector("div")?.children.length).toBe(0);
  });

  it("renders 'Approved' badge with done styling when overallVerdict is approved", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
  });

  it("renders 'Changes Requested' badge with blocked styling for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Overall looks solid." }} />);
    expect(screen.getByText("Overall looks solid.")).toBeDefined();
  });

  it("renders a findings count heading and each finding's title/severity", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "blocker",
          title: "Null pointer risk",
          details: "This could throw at runtime.",
        },
        {
          id: "f2",
          severity: "nit",
          title: "Style nit",
          details: "Prefer const over let.",
        },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("Null pointer risk")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Style nit")).toBeDefined();
    expect(screen.getByText("nit")).toBeDefined();
    expect(screen.getByText("This could throw at runtime.")).toBeDefined();
  });

  it("applies the correct severity style class for each known severity", () => {
    const review = {
      findings: [
        { id: "f1", severity: "blocker", title: "T1", details: "D1" },
        { id: "f2", severity: "important", title: "T2", details: "D2" },
        { id: "f3", severity: "suggestion", title: "T3", details: "D3" },
        { id: "f4", severity: "nit", title: "T4", details: "D4" },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("blocker").className).toContain("severity-blocker");
    expect(screen.getByText("important").className).toContain("severity-important");
    expect(screen.getByText("suggestion").className).toContain("severity-suggestion");
    expect(screen.getByText("nit").className).toContain("severity-nit");
  });

  it("falls back to the nit style for an unrecognized severity", () => {
    const review = {
      findings: [
        { id: "f1", severity: "catastrophic", title: "Weird severity", details: "D" },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("catastrophic").className).toContain("severity-nit");
  });

  it("shows the file path and line hint when provided", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "important",
          title: "Bug",
          details: "Details here",
          file: "src/foo.ts",
          lineHint: 42,
        },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("shows the file path without a line suffix when lineHint is absent", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "important",
          title: "Bug",
          details: "Details here",
          file: "src/foo.ts",
        },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("src/foo.ts")).toBeDefined();
  });

  it("shows the affected step id when file is absent but affectedStepId is present", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "important",
          title: "Bug",
          details: "Details here",
          affectedStepId: "step-3",
        },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("does not render the file/step metadata row when neither file nor affectedStepId is present", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "important",
          title: "Bug",
          details: "Details here",
        },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.queryByText(/Step:/)).toBeNull();
  });

  it("renders a full review with verdict, summary and multiple findings together", () => {
    const review = {
      overallVerdict: "approved",
      summary: "Ready to merge.",
      findings: [
        { id: "f1", severity: "nit", title: "Minor nit", details: "Fine as-is." },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("Approved")).toBeDefined();
    expect(screen.getByText("Ready to merge.")).toBeDefined();
    expect(screen.getByText("Findings (1)")).toBeDefined();
  });
});
