import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing meaningful for an empty review object", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.textContent).toBe("");
  });

  it("shows 'Approved' styling and label for an approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("shows 'Changes Requested' label for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    expect(screen.getByText("Changes Requested")).toBeDefined();
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Looks mostly good." }} />);
    expect(screen.getByText("Looks mostly good.")).toBeDefined();
  });

  it("renders a findings count heading and each finding's title and severity", () => {
    const review = {
      findings: [
        { id: "f1", severity: "blocker", title: "Missing null check", details: "Will throw" },
        { id: "f2", severity: "nit", title: "Naming", details: "Rename var" },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Will throw")).toBeDefined();
  });

  it("renders file and line hint for a finding that has them", () => {
    const review = {
      findings: [
        { id: "f1", severity: "important", title: "Bug", details: "details", file: "src/foo.ts", lineHint: 42 },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("renders the affected step id for a finding that references one", () => {
    const review = {
      findings: [
        { id: "f1", severity: "suggestion", title: "Bug", details: "details", affectedStepId: "step-3" },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("falls back to 'nit' severity styling for an unrecognized severity value", () => {
    const review = {
      findings: [{ id: "f1", severity: "weird-severity", title: "Odd", details: "d" }],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("weird-severity")).toBeDefined();
  });

  it("does not render a findings section when findings is an empty array", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });
});
