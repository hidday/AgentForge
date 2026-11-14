import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders an approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("renders a changes_requested verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    expect(screen.getByText("Changes Requested")).toBeDefined();
  });

  it("omits the verdict row when absent", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText("Verdict:")).toBeNull();
  });

  it("renders the summary when present", () => {
    render(<ReviewView review={{ summary: "Looks solid overall." }} />);
    expect(screen.getByText("Looks solid overall.")).toBeDefined();
  });

  it("renders findings with severity, title, file:line, step, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              file: "src/a.ts",
              lineHint: 42,
              affectedStepId: "s1",
              title: "Null deref",
              details: "Add a guard clause",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Null deref")).toBeDefined();
    expect(screen.getByText("src/a.ts:42")).toBeDefined();
    expect(screen.getByText("Step: s1")).toBeDefined();
    expect(screen.getByText("Add a guard clause")).toBeDefined();
  });

  it("falls back to the nit style for an unrecognized severity", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [{ id: "f1", severity: "weird", title: "t", details: "d" }],
        }}
      />,
    );
    const badge = container.querySelector(".uppercase");
    expect(badge?.className).toContain("severity-nit");
  });

  it("renders nothing for findings section when findings is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });
});
