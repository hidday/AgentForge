import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra for a review with no verdict, summary, or findings", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText(/Verdict:/)).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders an 'Approved' badge with the done styling when verdict is 'approved'", () => {
    const { container } = render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Verdict:")).toBeDefined();
    expect(screen.getByText("Approved")).toBeDefined();
    expect(container.querySelector(".bg-state-done-bg")).not.toBeNull();
  });

  it("renders a 'Changes Requested' badge with the blocked styling for any non-approved verdict", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "changes_requested" }} />,
    );
    expect(screen.getByText("Changes Requested")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked-bg")).not.toBeNull();
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Looks mostly good" }} />);
    expect(screen.getByText("Looks mostly good")).toBeDefined();
  });

  it("does not render a summary paragraph when absent", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.querySelector("p.text-sm")).toBeNull();
  });

  it("renders the findings count heading and each finding's title, severity and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "This will throw at runtime",
            },
            {
              id: "f2",
              severity: "nit",
              title: "Formatting",
              details: "Minor style issue",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("This will throw at runtime")).toBeDefined();
    expect(screen.getByText("nit")).toBeDefined();
    expect(screen.getByText("Formatting")).toBeDefined();
  });

  it("does not render the Findings section when findings is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("applies the known severity style classes for important and suggestion severities", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "important", title: "A", details: "a" },
            { id: "f2", severity: "suggestion", title: "B", details: "b" },
          ],
        }}
      />,
    );
    expect(container.querySelector(".text-severity-important")).not.toBeNull();
    expect(container.querySelector(".text-severity-suggestion")).not.toBeNull();
  });

  it("falls back to the nit style for an unrecognized severity value", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "totally-unknown", title: "A", details: "a" },
          ],
        }}
      />,
    );
    expect(container.querySelector(".text-severity-nit")).not.toBeNull();
    expect(screen.getByText("totally-unknown")).toBeDefined();
  });

  it("renders the file name with a line hint when both are present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Bug",
              details: "details",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("renders the file name without a line suffix when lineHint is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Bug",
              details: "details",
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
              severity: "blocker",
              title: "Bug",
              details: "details",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("renders neither a file nor a step line when both are absent", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "blocker", title: "Bug", details: "details" },
          ],
        }}
      />,
    );
    expect(container.querySelector(".font-mono.text-text-muted")).toBeNull();
  });
});
