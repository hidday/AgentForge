import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders version, score, summary, checks, files changed, notes, and PR status", () => {
    const report = {
      executionVersion: 2,
      score: 0.85,
      scoreRationale: "All checks passed cleanly",
      summary: "Implemented the feature end to end.",
      checks: {
        lint: { status: "pass", details: "0 problems" },
        tests: { status: "fail", details: "2 failing" },
        typecheck: { status: "skipped", details: "not run" },
      },
      filesChanged: ["src/a.ts", "src/b.ts"],
      notes: ["Watch out for the rate limiter"],
      prDraftCreated: true,
    };

    render(<ExecutionReportView report={report} />);

    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Score: 85%")).toBeDefined();
    expect(screen.getByText("All checks passed cleanly")).toBeDefined();
    expect(screen.getByText("Implemented the feature end to end.")).toBeDefined();

    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 problems")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failing")).toBeDefined();

    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();

    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Watch out for the rate limiter")).toBeDefined();

    expect(screen.getByText("PR Draft: Created")).toBeDefined();
  });

  it("renders 'Not created' when prDraftCreated is false", () => {
    render(
      <ExecutionReportView
        report={{ executionVersion: 1, prDraftCreated: false }}
      />,
    );
    expect(screen.getByText("PR Draft: Not created")).toBeDefined();
  });

  it("renders gracefully with an empty report (no summary, checks, files, notes, or score)", () => {
    const { container } = render(<ExecutionReportView report={{}} />);

    // Defaults to version 1
    expect(screen.getByText("v1")).toBeDefined();
    // None of the optional sections should render
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(container.textContent).toContain("v1");
  });
});
