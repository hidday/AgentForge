import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing distinctive when given an empty object", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.querySelector(".space-y-4")).not.toBeNull();
    expect(screen.queryByText("Verdict:")).toBeNull();
  });

  it("renders an approved verdict badge", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Verdict:")).toBeDefined();
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("text-state-done");
  });

  it("renders a changes-requested verdict badge for any non-approved verdict", () => {
    render(
      <ReviewView review={{ overallVerdict: "changes_requested" }} />,
    );
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("text-state-blocked");
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Looks solid overall." }} />);
    expect(screen.getByText("Looks solid overall.")).toBeDefined();
  });

  it("renders findings with severity, title, and details", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "blocker",
          title: "Missing null check",
          details: "This will throw on empty input.",
        },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("This will throw on empty input.")).toBeDefined();
  });

  it("falls back to nit styling for an unrecognized severity", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "totally-unknown",
          title: "Odd finding",
          details: "details",
        },
      ],
    };
    render(<ReviewView review={review} />);
    const badge = screen.getByText("totally-unknown");
    expect(badge.className).toContain("severity-nit");
  });

  it("renders file and lineHint when present", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "important",
          title: "Style issue",
          details: "details",
          file: "src/foo.ts",
          lineHint: 42,
        },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("renders file without a line suffix when lineHint is absent", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "important",
          title: "Style issue",
          details: "details",
          file: "src/foo.ts",
        },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("src/foo.ts")).toBeDefined();
  });

  it("renders affectedStepId when present", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "suggestion",
          title: "Consider refactor",
          details: "details",
          affectedStepId: "step-2",
        },
      ],
    };
    render(<ReviewView review={review} />);
    expect(screen.getByText("Step: step-2")).toBeDefined();
  });

  it("omits the file/step meta row entirely when neither is present", () => {
    const review = {
      findings: [
        {
          id: "f1",
          severity: "nit",
          title: "Minor nit",
          details: "details",
        },
      ],
    };
    const { container } = render(<ReviewView review={review} />);
    expect(container.querySelector(".font-mono.text-text-muted")).toBeNull();
  });
});
