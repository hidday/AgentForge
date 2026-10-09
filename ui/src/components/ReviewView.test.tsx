import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra when review payload is empty", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.textContent).toBe("");
  });

  it("renders 'Approved' verdict badge styled as done", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
  });

  it("renders 'Changes Requested' verdict badge styled as blocked for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Looks mostly good." }} />);
    expect(screen.getByText("Looks mostly good.")).toBeDefined();
  });

  it("renders findings count heading and each finding's title/severity/details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "Will throw at runtime.",
            },
            {
              id: "f2",
              severity: "nit",
              title: "Rename variable",
              details: "Minor readability issue.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("Will throw at runtime.")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Rename variable")).toBeDefined();
    expect(screen.getByText("nit")).toBeDefined();
  });

  it("falls back to the 'nit' severity style for an unrecognized severity value", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "unknown_severity",
              title: "Weird finding",
              details: "details",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("unknown_severity");
    expect(badge.className).toContain("severity-nit");
  });

  it("renders file and lineHint when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Bug",
              details: "d",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/src\/foo\.ts/)).toBeDefined();
    expect(screen.getByText(/:42/)).toBeDefined();
  });

  it("renders the affected step id when present instead of file", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Bug",
              details: "d",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/Step: step-3/)).toBeDefined();
  });

  it("does not render the file/step metadata row when neither is present", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "important", title: "Bug", details: "d" },
          ],
        }}
      />,
    );
    expect(container.querySelector(".font-mono")).toBeNull();
  });
});
