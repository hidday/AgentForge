import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra for an empty review", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(screen.queryByText(/Verdict/)).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
    expect(container.querySelector(".space-y-4")).not.toBeNull();
  });

  it("renders 'Approved' badge with done styling for an approved verdict", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "approved" }} />,
    );
    expect(screen.getByText("Verdict:")).toBeDefined();
    expect(screen.getByText("Approved")).toBeDefined();
    expect(container.querySelector(".bg-state-done-bg")).not.toBeNull();
  });

  it("renders 'Changes Requested' badge with blocked styling for any non-approved verdict", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "changes_requested" }} />,
    );
    expect(screen.getByText("Changes Requested")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked-bg")).not.toBeNull();
  });

  it("does not render the verdict row when overallVerdict is absent", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText("Verdict:")).toBeNull();
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Overall looks solid." }} />);
    expect(screen.getByText("Overall looks solid.")).toBeDefined();
  });

  it("does not render a summary paragraph when absent", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("renders findings with severity badge, title, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "This will throw on empty input.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("This will throw on empty input.")).toBeDefined();
  });

  it("falls back to the nit severity style for an unrecognized severity", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "totally-unknown",
              title: "Weird finding",
              details: "details",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("totally-unknown");
    expect(badge.className).toContain("severity-nit");
    expect(container).toBeDefined();
  });

  it("renders the file and line hint when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Off by one",
              details: "Loop bound is wrong.",
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

  it("renders the file without a line suffix when lineHint is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "Consider renaming",
              details: "details",
              file: "src/index.ts",
            },
          ],
        }}
      />,
    );
    const fileEl = screen.getByText("src/index.ts");
    expect(fileEl.textContent).toBe("src/index.ts");
  });

  it("renders the affected step id when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "Style nit",
              details: "details",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("does not render the file/step meta row when neither is present", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "Style nit",
              details: "details",
            },
          ],
        }}
      />,
    );
    expect(container.querySelector(".font-mono.mb-1")).toBeNull();
  });

  it("does not render the Findings section when findings is empty", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders multiple findings and reflects the count in the header", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "blocker", title: "A", details: "a" },
            { id: "f2", severity: "nit", title: "B", details: "b" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (2)")).toBeDefined();
  });
});
