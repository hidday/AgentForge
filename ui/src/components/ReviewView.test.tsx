import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra for an empty review", () => {
    render(<ReviewView review={{}} />);

    expect(screen.queryByText("Verdict:")).toBeNull();
    expect(screen.queryByText(/^Findings/)).toBeNull();
  });

  it("renders the approved verdict with done styling", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "approved" }} />,
    );

    expect(screen.getByText("Verdict:")).toBeDefined();
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
    expect(container).toBeDefined();
  });

  it("renders a non-approved verdict as Changes Requested with blocked styling", () => {
    const badge = render(
      <ReviewView review={{ overallVerdict: "changes_requested" }} />,
    ).getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
  });

  it("renders the summary when present", () => {
    render(<ReviewView review={{ summary: "Looks mostly good." }} />);
    expect(screen.getByText("Looks mostly good.")).toBeDefined();
  });

  it("renders findings with severity badges, file/line/step metadata, and an unknown-severity fallback", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "blocker",
          title: "Null pointer risk",
          details: "This can throw.",
          file: "src/a.ts",
          lineHint: 42,
          affectedStepId: "step-1",
        },
        {
          id: "f2",
          severity: "important",
          title: "Missing step metadata",
          details: "No file here.",
          affectedStepId: "step-2",
        },
        {
          id: "f3",
          severity: "suggestion",
          title: "File without line hint",
          details: "Consider renaming.",
          file: "src/b.ts",
        },
        {
          id: "f4",
          severity: "totally-unknown",
          title: "Mystery severity",
          details: "No file, no step.",
        },
      ],
    };

    render(<ReviewView review={review} />);

    expect(screen.getByText("Findings (4)")).toBeDefined();

    expect(screen.getByText("Null pointer risk")).toBeDefined();
    expect(screen.getByText("src/a.ts:42")).toBeDefined();
    expect(screen.getByText("Step: step-1")).toBeDefined();

    expect(screen.getByText("Missing step metadata")).toBeDefined();
    expect(screen.getByText("Step: step-2")).toBeDefined();

    expect(screen.getByText("File without line hint")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();

    expect(screen.getByText("Mystery severity")).toBeDefined();
    const mysteryBadge = screen.getByText("totally-unknown");
    // Falls back to the "nit" severity style.
    expect(mysteryBadge.className).toContain("bg-severity-nit/10");
  });

  it("omits the file/step metadata row when neither file nor affectedStepId is present", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "nit",
          title: "No metadata finding",
          details: "Just text.",
        },
      ],
    };
    render(<ReviewView review={review} />);

    expect(screen.getByText("No metadata finding")).toBeDefined();
    expect(screen.queryByText(/^Step:/)).toBeNull();
  });
});
