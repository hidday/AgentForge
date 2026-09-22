import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing for verdict/summary/findings when the review is empty", () => {
    render(<ReviewView review={{}} />);

    expect(screen.queryByText(/Verdict:/i)).toBeNull();
    expect(screen.queryByText(/Findings/i)).toBeNull();
  });

  it("renders an 'Approved' badge with done styling for an approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);

    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
    expect(badge.className).toContain("text-state-done");
  });

  it("renders a 'Changes Requested' badge with blocked styling for a non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);

    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
    expect(badge.className).toContain("text-state-blocked");
  });

  it("renders the summary text when present", () => {
    render(<ReviewView review={{ summary: "Looks mostly good." }} />);

    expect(screen.getByText("Looks mostly good.")).toBeDefined();
  });

  it("renders the findings count heading and each finding's title/severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "This will throw on empty input.",
              file: "src/foo.ts",
              lineHint: 42,
            },
            {
              id: "f2",
              severity: "nit",
              title: "Prefer const",
              details: "Use const instead of let.",
              affectedStepId: "step-2",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
    expect(screen.getByText("Prefer const")).toBeDefined();
    expect(screen.getByText("nit")).toBeDefined();
    expect(screen.getByText("Step: step-2")).toBeDefined();
  });

  it("falls back to the nit style for an unknown severity", () => {
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

    const badge = screen.getByText("unknown-severity");
    expect(badge.className).toContain("bg-severity-nit/10");
  });

  it("omits the file/step metadata row when neither file nor affectedStepId is set", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "No location info",
              details: "Just a general note.",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("No location info")).toBeDefined();
    expect(screen.queryByText(/Step:/i)).toBeNull();
  });

  it("renders the file without a line suffix when lineHint is not provided", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "File-only finding",
              details: "No line hint given.",
              file: "src/bar.ts",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("src/bar.ts")).toBeDefined();
  });
});
