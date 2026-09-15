import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders every optional section for a full payload", () => {
    const review = {
      overallVerdict: "approved",
      summary: "Overall looks good",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          title: "Missing null check",
          details: "Will throw at runtime",
          file: "src/index.ts",
          lineHint: 42,
        },
        {
          id: "f2",
          severity: "important",
          title: "Step mismatch",
          details: "Doesn't match plan",
          affectedStepId: "step-1",
        },
      ],
    };
    render(<ReviewView review={review} />);

    expect(screen.getByText("Verdict:")).toBeDefined();
    expect(screen.getByText("Approved")).toBeDefined();
    expect(screen.getByText("Overall looks good")).toBeDefined();
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("Will throw at runtime")).toBeDefined();
    expect(screen.getByText("src/index.ts:42")).toBeDefined();
    expect(screen.getByText("Step mismatch")).toBeDefined();
    expect(screen.getByText("Step: step-1")).toBeDefined();
  });

  it("shows the 'Changes Requested' badge with blocked styling for a non-approved verdict", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "changes_requested" }} />,
    );
    const badge = screen.getByText("Changes Requested");
    expect(badge).toBeDefined();
    expect(badge.className).toContain("bg-state-blocked-bg");
    expect(badge.className).toContain("text-state-blocked");
    expect(container.querySelector(".bg-state-done-bg")).toBeNull();
  });

  it("shows the 'Approved' badge with done styling for an approved verdict", () => {
    const badge = render(<ReviewView review={{ overallVerdict: "approved" }} />).getByText(
      "Approved",
    );
    expect(badge.className).toContain("bg-state-done-bg");
    expect(badge.className).toContain("text-state-done");
  });

  it("renders no verdict line when overallVerdict is absent", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText("Verdict:")).toBeNull();
  });

  it("renders no summary paragraph when summary is absent", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.queryByText(/summary/i)).toBeNull();
  });

  it("applies the blocker severity style", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "blocker", title: "T", details: "D" },
          ],
        }}
      />,
    );
    const badge = screen.getByText("blocker");
    expect(badge.className).toContain("bg-severity-blocker/10");
    expect(badge.className).toContain("text-severity-blocker");
  });

  it("applies the important severity style", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "important", title: "T", details: "D" },
          ],
        }}
      />,
    );
    const badge = screen.getByText("important");
    expect(badge.className).toContain("bg-severity-important/10");
    expect(badge.className).toContain("text-severity-important");
  });

  it("applies the suggestion severity style", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "suggestion", title: "T", details: "D" },
          ],
        }}
      />,
    );
    const badge = screen.getByText("suggestion");
    expect(badge.className).toContain("bg-severity-suggestion/10");
    expect(badge.className).toContain("text-severity-suggestion");
  });

  it("applies the nit severity style", () => {
    render(
      <ReviewView
        review={{
          findings: [{ id: "f1", severity: "nit", title: "T", details: "D" }],
        }}
      />,
    );
    const badge = screen.getByText("nit");
    expect(badge.className).toContain("bg-severity-nit/10");
    expect(badge.className).toContain("text-severity-nit");
  });

  it("falls back to the nit style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "mystery", title: "T", details: "D" },
          ],
        }}
      />,
    );
    const badge = screen.getByText("mystery");
    expect(badge.className).toContain("bg-severity-nit/10");
    expect(badge.className).toContain("text-severity-nit");
  });

  it("renders a file+lineHint metadata line without lineHint suffix when lineHint is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "T",
              details: "D",
              file: "src/app.ts",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/app.ts")).toBeDefined();
  });

  it("renders no metadata line when neither file nor affectedStepId is present", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [{ id: "f1", severity: "nit", title: "T", details: "D" }],
        }}
      />,
    );
    expect(container.querySelector(".font-mono.text-text-muted")).toBeNull();
  });

  it("renders nothing extra for an empty findings array", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });
});
