import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra for an empty review object", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText("Verdict:")).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders 'Approved' badge with done styling when verdict is approved", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "approved" }} />,
    );
    expect(screen.getByText("Verdict:")).toBeDefined();
    const badge = screen.getByText("Approved");
    expect(badge).toBeDefined();
    expect(badge.className).toContain("bg-state-done-bg");
    expect(container.querySelector(".bg-state-blocked-bg")).toBeNull();
  });

  it("renders 'Changes Requested' badge with blocked styling for any non-approved verdict", () => {
    const badgeText = "Changes Requested";
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText(badgeText);
    expect(badge).toBeDefined();
    expect(badge.className).toContain("bg-state-blocked-bg");
  });

  it("renders the summary text when provided", () => {
    render(<ReviewView review={{ summary: "This review looks solid." }} />);
    expect(screen.getByText("This review looks solid.")).toBeDefined();
  });

  it("does not render summary paragraph when summary is absent", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.querySelector("p.text-text-secondary")).toBeNull();
  });

  it("renders findings count heading and each finding's severity, title, and details", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "blocker",
          title: "Critical bug",
          details: "Null pointer in handler",
        },
        {
          id: "f2",
          severity: "nit",
          title: "Minor style issue",
          details: "Missing trailing comma",
        },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("nit")).toBeDefined();
    expect(screen.getByText("Critical bug")).toBeDefined();
    expect(screen.getByText("Minor style issue")).toBeDefined();
    expect(screen.getByText("Null pointer in handler")).toBeDefined();
    expect(screen.getByText("Missing trailing comma")).toBeDefined();
  });

  it("does not render Findings section when findings array is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("applies known severity styles for blocker, important, suggestion, and nit", () => {
    const review = {
      findings: [
        { id: "f1", severity: "blocker", title: "t1", details: "d1" },
        { id: "f2", severity: "important", title: "t2", details: "d2" },
        { id: "f3", severity: "suggestion", title: "t3", details: "d3" },
        { id: "f4", severity: "nit", title: "t4", details: "d4" },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("blocker").className).toContain(
      "text-severity-blocker",
    );
    expect(screen.getByText("important").className).toContain(
      "text-severity-important",
    );
    expect(screen.getByText("suggestion").className).toContain(
      "text-severity-suggestion",
    );
    expect(screen.getByText("nit").className).toContain("text-severity-nit");
  });

  it("falls back to nit styling for an unknown severity value", () => {
    const review = {
      findings: [
        { id: "f1", severity: "totally-unknown", title: "t1", details: "d1" },
      ],
    };
    render(<ReviewView review={review} />);
    const badge = screen.getByText("totally-unknown");
    expect(badge.className).toContain("text-severity-nit");
  });

  it("renders file and lineHint metadata when present", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "nit",
          title: "t1",
          details: "d1",
          file: "src/index.ts",
          lineHint: 42,
        },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("src/index.ts:42")).toBeDefined();
  });

  it("renders file without a line suffix when lineHint is absent", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "nit",
          title: "t1",
          details: "d1",
          file: "src/index.ts",
        },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("src/index.ts")).toBeDefined();
  });

  it("renders affectedStepId metadata when present", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "nit",
          title: "t1",
          details: "d1",
          affectedStepId: "step-3",
        },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("renders neither file/step metadata row when both are absent", () => {
    const review = {
      findings: [{ id: "f1", severity: "nit", title: "t1", details: "d1" }],
    };
    const { container } = render(<ReviewView review={review} />);
    expect(container.querySelector(".font-mono.text-text-muted")).toBeNull();
  });

  it("renders both file and affectedStepId together within the same metadata row", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "nit",
          title: "t1",
          details: "d1",
          file: "a.ts",
          affectedStepId: "step-1",
        },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("a.ts")).toBeDefined();
    expect(screen.getByText("Step: step-1")).toBeDefined();
  });
});
