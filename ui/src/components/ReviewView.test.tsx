import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing for an empty review", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.querySelector(".space-y-4")?.children.length).toBe(0);
  });

  it("renders the 'Approved' badge with done styling for an approved verdict", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "approved" }} />,
    );
    expect(screen.getByText("Verdict:")).toBeDefined();
    expect(screen.getByText("Approved")).toBeDefined();
    expect(container.querySelector(".bg-state-done-bg")).toBeTruthy();
  });

  it("renders the 'Changes Requested' badge with blocked styling for any non-approved verdict", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "changes_requested" }} />,
    );
    expect(screen.getByText("Changes Requested")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked-bg")).toBeTruthy();
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Overall looks solid" }} />);
    expect(screen.getByText("Overall looks solid")).toBeDefined();
  });

  it("renders findings with a count, known severity styling, file, line hint and step", () => {
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
              details: "Could crash on empty input",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Null pointer risk")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
    expect(screen.getByText("Step: step-1")).toBeDefined();
    expect(screen.getByText("Could crash on empty input")).toBeDefined();
  });

  it("falls back to the nit severity style for an unrecognized severity", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f2",
              severity: "weird-severity",
              title: "Odd finding",
              details: "details here",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("weird-severity")).toBeDefined();
    expect(container.querySelector(".bg-severity-nit\\/10")).toBeTruthy();
  });

  it("omits the file/step line when neither file nor affectedStepId is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f3",
              severity: "suggestion",
              title: "No location finding",
              details: "no file info",
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/)).toBeNull();
    expect(screen.getByText("No location finding")).toBeDefined();
  });

  it("renders the file without a line suffix when lineHint is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f4",
              severity: "important",
              file: "src/bar.ts",
              title: "File only finding",
              details: "no line hint",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/bar.ts")).toBeDefined();
  });

  it("does not render the findings section when findings is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });
});
