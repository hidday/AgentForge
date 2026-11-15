import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing distinctive for a completely empty review object", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(screen.queryByText(/Verdict/)).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("shows 'Approved' styling and label when overallVerdict is approved", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
  });

  it("shows 'Changes Requested' styling and label for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Looks mostly good." }} />);
    expect(screen.getByText("Looks mostly good.")).toBeDefined();
  });

  it("does not render a summary paragraph when summary is absent", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.queryByText(/Looks mostly good/)).toBeNull();
  });

  it("does not render a findings section when findings is empty or absent", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders the findings count heading and each finding's title/severity/details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Null pointer risk",
              details: "This can crash on empty input.",
            },
            {
              id: "f2",
              severity: "nit",
              title: "Naming nit",
              details: "Prefer camelCase.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("Null pointer risk")).toBeDefined();
    expect(screen.getByText("This can crash on empty input.")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Naming nit")).toBeDefined();
    expect(screen.getByText("nit")).toBeDefined();
  });

  it("falls back to the nit severity style for an unrecognized severity value", () => {
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
    const severityBadge = screen.getByText("unknown-severity");
    expect(severityBadge.className).toContain("bg-severity-nit/10");
  });

  it("shows file and lineHint together, formatted as file:line", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Issue",
              details: "Details",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("shows only the file name (no colon) when lineHint is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Issue",
              details: "Details",
              file: "src/foo.ts",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts")).toBeDefined();
    expect(screen.queryByText(/src\/foo\.ts:/)).toBeNull();
  });

  it("shows the affected step id when file is absent but affectedStepId is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "Issue",
              details: "Details",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("does not render the file/step metadata row when neither file nor affectedStepId is present", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "Issue",
              details: "Details",
            },
          ],
        }}
      />,
    );
    expect(container.querySelector(".font-mono.text-text-muted")).toBeNull();
  });
});
