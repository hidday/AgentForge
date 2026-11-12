import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders an approved verdict with the done styling", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "approved", summary: "Looks good." }} />,
    );

    expect(screen.getByText("Approved")).toBeDefined();
    expect(screen.getByText("Looks good.")).toBeDefined();
    expect(container.querySelector(".bg-state-done-bg")).not.toBeNull();
  });

  it("renders a changes-requested verdict with the blocked styling", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "changes_requested" }} />,
    );

    expect(screen.getByText("Changes Requested")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked-bg")).not.toBeNull();
  });

  it("does not render the verdict row when overallVerdict is missing", () => {
    render(<ReviewView review={{ summary: "No verdict yet." }} />);
    expect(screen.queryByText(/Verdict:/)).toBeNull();
  });

  it("does not render a summary paragraph when summary is missing", () => {
    const { container } = render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("renders findings with severity, file, line, step, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              file: "src/foo.ts",
              lineHint: 42,
              affectedStepId: "step-1",
              title: "Null pointer risk",
              details: "This can throw if foo is undefined.",
            },
            {
              id: "f2",
              severity: "unknown-severity",
              title: "Odd severity",
              details: "Falls back to nit styling.",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Null pointer risk")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
    expect(screen.getByText("Step: step-1")).toBeDefined();
    expect(screen.getByText("This can throw if foo is undefined.")).toBeDefined();

    // Unknown severity falls back to the "nit" style class and still renders.
    expect(screen.getByText("unknown-severity")).toBeDefined();
    expect(screen.getByText("Odd severity")).toBeDefined();
  });

  it("omits the file/step metadata line when neither is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "No location info",
              details: "details here",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("No location info")).toBeDefined();
    expect(screen.queryByText(/Step:/)).toBeNull();
  });

  it("renders nothing for findings when the list is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/^Findings/)).toBeNull();
  });
});
