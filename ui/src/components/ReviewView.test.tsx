import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing of substance when review is an empty object", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText(/Verdict:/)).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders 'Approved' styling and label for overallVerdict 'approved'", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("text-state-done");
  });

  it("renders 'Changes Requested' styling and label for a non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("text-state-blocked");
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Looks mostly good." }} />);
    expect(screen.getByText("Looks mostly good.")).toBeDefined();
  });

  it("does not render a summary paragraph when summary is absent", () => {
    render(<ReviewView review={{}} />);
    expect(document.querySelector("p.text-text-secondary")).toBeNull();
  });

  it("renders a findings count heading and each finding's title/severity/details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Null pointer risk",
              details: "This can crash under X condition.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Null pointer risk")).toBeDefined();
    expect(screen.getByText("This can crash under X condition.")).toBeDefined();
  });

  it("does not render the findings section when findings array is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("falls back to the 'nit' style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "mystery", title: "Weird finding", details: "details here" },
          ],
        }}
      />,
    );
    const severityBadge = screen.getByText("mystery");
    expect(severityBadge.className).toContain("severity-nit");
  });

  it("renders file and lineHint together as file:line", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "t",
              details: "d",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("renders file without a line suffix when lineHint is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "important", title: "t", details: "d", file: "src/foo.ts" },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts")).toBeDefined();
  });

  it("renders affectedStepId when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "t",
              details: "d",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("does not render the file/step meta row when neither file nor affectedStepId is set", () => {
    render(
      <ReviewView
        review={{ findings: [{ id: "f1", severity: "nit", title: "t", details: "d" }] }}
      />,
    );
    expect(document.querySelector(".font-mono.text-text-muted")).toBeNull();
  });

  it("renders multiple findings each keyed by id", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "nit", title: "First", details: "d1" },
            { id: "f2", severity: "blocker", title: "Second", details: "d2" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("First")).toBeDefined();
    expect(screen.getByText("Second")).toBeDefined();
  });
});
