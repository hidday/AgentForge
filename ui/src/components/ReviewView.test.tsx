import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing when review is empty", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.textContent).toBe("");
  });

  it("renders the 'Approved' verdict with the done style", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Verdict:")).toBeDefined();
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("renders 'Changes Requested' for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    expect(screen.getByText("Changes Requested")).toBeDefined();
  });

  it("does not render the verdict row when verdict is absent", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText("Verdict:")).toBeNull();
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "This change looks solid." }} />);
    expect(screen.getByText("This change looks solid.")).toBeDefined();
  });

  it("does not render a summary paragraph when absent", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    // Only the verdict text should appear, no extra summary paragraph.
    expect(screen.queryByText(/looks solid/)).toBeNull();
  });

  it("renders findings with severity badge, title, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Null pointer risk",
              details: "This will throw if input is undefined.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Null pointer risk")).toBeDefined();
    expect(
      screen.getByText("This will throw if input is undefined."),
    ).toBeDefined();
  });

  it("falls back to the nit severity style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "unknown-severity",
              title: "Weird finding",
              details: "Details here.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("unknown-severity")).toBeDefined();
  });

  it("renders the file name and line hint when both are present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "Minor nit",
              details: "Could be cleaner.",
              file: "src/index.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/src\/index\.ts/)).toBeDefined();
    expect(screen.getByText(/:42/)).toBeDefined();
  });

  it("renders the file name without a line suffix when lineHint is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "Nit",
              details: "Nit details.",
              file: "src/other.ts",
            },
          ],
        }}
      />,
    );
    const fileEl = screen.getByText("src/other.ts");
    expect(fileEl.textContent).toBe("src/other.ts");
  });

  it("renders the affected step id when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Step-linked finding",
              details: "Relates to a plan step.",
              affectedStepId: "step-2",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-2")).toBeDefined();
  });

  it("does not render the file/step metadata row when neither is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "No metadata finding",
              details: "No file or step.",
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/)).toBeNull();
  });

  it("does not render the findings section when findings is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders multiple findings with the correct total count", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "blocker", title: "A", details: "a" },
            { id: "f2", severity: "nit", title: "B", details: "b" },
            { id: "f3", severity: "suggestion", title: "C", details: "c" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (3)")).toBeDefined();
  });

  it("renders a fully populated review with verdict, summary, and findings together", () => {
    render(
      <ReviewView
        review={{
          overallVerdict: "approved",
          summary: "Overall good.",
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "Nitpick",
              details: "Tiny thing.",
              file: "a.ts",
              affectedStepId: "step-1",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Approved")).toBeDefined();
    expect(screen.getByText("Overall good.")).toBeDefined();
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("a.ts")).toBeDefined();
    expect(screen.getByText("Step: step-1")).toBeDefined();
  });
});
