import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

const richReview: Record<string, unknown> = {
  overallVerdict: "changes_requested",
  summary: "The review summary text.",
  findings: [
    {
      id: "f1",
      severity: "blocker",
      title: "Blocker finding",
      details: "This must be fixed.",
      file: "src/foo.ts",
      lineHint: 42,
      affectedStepId: "s1",
    },
    {
      id: "f2",
      severity: "important",
      title: "Important finding",
      details: "Should be addressed.",
    },
    {
      id: "f3",
      severity: "suggestion",
      title: "Suggestion finding",
      details: "Consider this.",
    },
    {
      id: "f4",
      severity: "nit",
      title: "Nit finding",
      details: "Minor nit.",
    },
    {
      id: "f5",
      severity: "unknown-severity",
      title: "Unknown severity finding",
      details: "Falls back to nit styling.",
    },
  ],
};

describe("ReviewView", () => {
  it("renders verdict, summary and findings for a rich payload", () => {
    render(<ReviewView review={richReview} />);

    expect(screen.getByText("Verdict:")).toBeDefined();
    expect(screen.getByText("Changes Requested")).toBeDefined();
    expect(screen.getByText("The review summary text.")).toBeDefined();
    expect(screen.getByText("Findings (5)")).toBeDefined();

    expect(screen.getByText("Blocker finding")).toBeDefined();
    expect(screen.getByText("This must be fixed.")).toBeDefined();
    expect(screen.getByText(/src\/foo\.ts/)).toBeDefined();
    expect(screen.getByText(/:42/)).toBeDefined();
    expect(screen.getByText("Step: s1")).toBeDefined();

    expect(screen.getByText("Important finding")).toBeDefined();
    expect(screen.getByText("Suggestion finding")).toBeDefined();
    expect(screen.getByText("Nit finding")).toBeDefined();
    expect(screen.getByText("Unknown severity finding")).toBeDefined();
  });

  it("renders the Approved verdict badge with done styling", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
  });

  it("renders the Changes Requested verdict badge with blocked styling", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
  });

  it("falls back to nit severity styling for an unrecognized severity", () => {
    render(
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
    const severityTag = screen.getByText("totally-unknown");
    expect(severityTag.className).toContain("bg-severity-nit/10");
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
    expect(screen.queryByText("Step:", { exact: false })).toBeNull();
  });

  it("renders file without a line hint when lineHint is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "File only finding",
              details: "details",
              file: "src/bar.ts",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/bar.ts")).toBeDefined();
  });

  it("renders a minimal/empty payload without verdict, summary or findings sections", () => {
    const { container } = render(<ReviewView review={{}} />);

    expect(screen.queryByText("Verdict:")).toBeNull();
    expect(screen.queryByText(/^Findings/)).toBeNull();
    expect(container.firstChild).not.toBeNull();
  });

  it("treats an empty findings array as no findings section", () => {
    render(<ReviewView review={{ findings: [] }} />);
    expect(screen.queryByText(/^Findings/)).toBeNull();
  });
});
