import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing when the review has no verdict, summary, or findings", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText(/Verdict/)).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("shows an 'Approved' badge for an approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
  });

  it("shows a 'Changes Requested' badge for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Overall looks solid." }} />);
    expect(screen.getByText("Overall looks solid.")).toBeDefined();
  });

  it("renders a findings heading with the count and each finding's title/details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "This will throw on null input.",
              file: "src/foo.ts",
              lineHint: 42,
            },
            {
              id: "f2",
              severity: "nit",
              title: "Prefer const",
              details: "Use const instead of let.",
              affectedStepId: "s2",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("This will throw on null input.")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
    expect(screen.getByText("Prefer const")).toBeDefined();
    expect(screen.getByText("Step: s2")).toBeDefined();
  });

  it("falls back to the nit severity style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "unknown-severity",
              title: "Some finding",
              details: "Details here",
            },
          ],
        }}
      />,
    );

    const badge = screen.getByText("unknown-severity");
    expect(badge.className).toContain("severity-nit");
  });

  it("omits the file/step metadata row when neither file nor affectedStepId is set", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              title: "No location finding",
              details: "No file or step attached",
            },
          ],
        }}
      />,
    );

    expect(screen.queryByText(/^Step:/)).toBeNull();
  });

  it("renders a file without a lineHint without appending a colon", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "File-only finding",
              details: "No line hint",
              file: "src/bar.ts",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("src/bar.ts")).toBeDefined();
  });
});
