import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing for verdict/summary/findings when all are absent", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText("Verdict:")).toBeNull();
  });

  it("renders the Approved badge in done styling when verdict is approved", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("state-done");
  });

  it("renders the Changes Requested badge in blocked styling for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("state-blocked");
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Looks solid overall." }} />);
    expect(screen.getByText("Looks solid overall.")).toBeDefined();
  });

  it("renders findings with their count heading", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "blocker", title: "Missing null check", details: "detail 1" },
            { id: "f2", severity: "nit", title: "Naming nit", details: "detail 2" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("Naming nit")).toBeDefined();
    expect(screen.getByText("detail 1")).toBeDefined();
  });

  it("does not render the Findings section when findings is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("falls back to the nit severity style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "unknown-sev", title: "Weird finding", details: "d" },
          ],
        }}
      />,
    );
    const sev = screen.getByText("unknown-sev");
    expect(sev.className).toContain("severity-nit");
  });

  it("renders file and lineHint when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "File issue",
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
            {
              id: "f1",
              severity: "important",
              title: "File issue",
              details: "d",
              file: "src/foo.ts",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts")).toBeDefined();
  });

  it("renders the affected step id when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "Step issue",
              details: "d",
              affectedStepId: "step-2",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-2")).toBeDefined();
  });

  it("does not render the file/step meta row when neither is present", () => {
    render(
      <ReviewView
        review={{
          findings: [{ id: "f1", severity: "nit", title: "No meta", details: "d" }],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/)).toBeNull();
  });
});
