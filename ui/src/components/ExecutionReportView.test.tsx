import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the default version (v1) when executionVersion is not provided", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders a custom execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render a score bar or rationale when score is not provided", () => {
    const { container } = render(<ExecutionReportView report={{}} />);
    expect(container.querySelector(".bg-state-done")).toBeNull();
    expect(container.querySelector(".bg-state-waiting")).toBeNull();
    expect(container.querySelector(".bg-state-blocked")).toBeNull();
    expect(screen.queryByText(/Score:/)).toBeNull();
  });

  it("renders a high (done-colored) score bar for score >= 0.7", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.85 }} />);
    expect(screen.getByText("Score: 85%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders a medium (waiting-colored) score bar for 0.4 <= score < 0.7", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a low (blocked-colored) score bar for score < 0.4", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(screen.getByText("Score: 20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders score rationale only when both score and scoreRationale are present", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.9, scoreRationale: "Everything checks out." }}
      />,
    );
    expect(screen.getByText("Everything checks out.")).toBeDefined();
  });

  it("does not render score rationale when score is missing, even if scoreRationale is set", () => {
    render(<ExecutionReportView report={{ scoreRationale: "Orphan rationale" }} />);
    expect(screen.queryByText("Orphan rationale")).toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "**Bold summary text**" }} />);
    // react-markdown renders the emphasis, leaving the plain text content
    expect(screen.getByText("Bold summary text")).toBeDefined();
  });

  it("does not render a summary section when summary is absent", () => {
    const { container } = render(<ExecutionReportView report={{}} />);
    expect(container.querySelector(".leading-relaxed.text-sm")).toBeNull();
  });

  it("renders no Checks section when checks is null/absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders pass/fail/other check rows with the right status styling", () => {
    const { container } = render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 problems" },
            typecheck: { status: "fail", details: "3 errors" },
            test: { status: "skipped", details: "not run" },
          },
        }}
      />,
    );

    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("test")).toBeDefined();
    expect(screen.getByText("0 problems")).toBeDefined();
    expect(screen.getByText("3 errors")).toBeDefined();
    expect(screen.getByText("not run")).toBeDefined();

    // Pass -> done styling, fail -> blocked styling, anything else -> neutral styling.
    expect(container.querySelector(".border-state-done\\/30")).not.toBeNull();
    expect(container.querySelector(".border-state-blocked\\/30")).not.toBeNull();
    expect(container.querySelector(".border-border-subtle.bg-surface")).not.toBeNull();
  });

  it("does not render a Files Changed section when filesChanged is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders the Files Changed section with a count and each file path", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("does not render a Notes section when notes is empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("renders each note as a markdown bullet", () => {
    render(
      <ExecutionReportView
        report={{ notes: ["First note", "Second **note**"] }}
      />,
    );
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("First note")).toBeDefined();
    expect(screen.getByText("Second")).toBeDefined();
    expect(screen.getByText("note")).toBeDefined();
  });

  it("does not render PR draft status when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });

  it("renders 'Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:/)).toBeDefined();
    expect(screen.getByText(/Created/)).toBeDefined();
  });

  it("renders 'Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/Not created/)).toBeDefined();
  });

  it("renders a fully populated report end to end", () => {
    render(
      <ExecutionReportView
        report={{
          executionVersion: 2,
          score: 0.72,
          scoreRationale: "Solid implementation with minor gaps.",
          summary: "Implemented the feature per the plan.",
          checks: {
            lint: { status: "pass", details: "clean" },
            test: { status: "fail", details: "2 failing" },
          },
          filesChanged: ["src/foo.ts"],
          notes: ["Follow-up needed for edge case X."],
          prDraftCreated: true,
        }}
      />,
    );

    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Score: 72%")).toBeDefined();
    expect(screen.getByText("Solid implementation with minor gaps.")).toBeDefined();
    expect(screen.getByText("Implemented the feature per the plan.")).toBeDefined();
    expect(screen.getByText("Files Changed (1)")).toBeDefined();
    expect(screen.getByText("src/foo.ts")).toBeDefined();
    expect(screen.getByText("Follow-up needed for edge case X.")).toBeDefined();
    expect(screen.getByText(/Created/)).toBeDefined();
  });
});
