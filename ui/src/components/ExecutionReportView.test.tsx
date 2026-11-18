import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("defaults executionVersion to 1 when absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders the given executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 2 }} />);
    expect(screen.getByText("v2")).toBeDefined();
  });

  it.each([
    [0.9, "bg-state-done"],
    [0.5, "bg-state-waiting"],
    [0.1, "bg-state-blocked"],
  ])("colors the score bar for score=%s", (score, expectedClass) => {
    const { container } = render(<ExecutionReportView report={{ score }} />);
    expect(container.querySelector(`.${expectedClass}`)).not.toBeNull();
    expect(screen.getByText(`Score: ${Math.round(score * 100)}%`)).toBeDefined();
  });

  it("does not render a score bar when score is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/^Score:/)).toBeNull();
  });

  it("renders score rationale only when both score and rationale are present", () => {
    render(
      <ExecutionReportView report={{ score: 0.8, scoreRationale: "Solid test coverage." }} />,
    );
    expect(screen.getByText("Solid test coverage.")).toBeDefined();
  });

  it("does not render rationale when score is absent even if rationale text exists", () => {
    render(<ExecutionReportView report={{ scoreRationale: "Should not show" }} />);
    expect(screen.queryByText("Should not show")).toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the feature." }} />);
    expect(screen.getByText("Implemented the feature.")).toBeDefined();
  });

  it("renders checks with pass/fail/other status icons and details", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 errors" },
            typecheck: { status: "fail", details: "2 errors" },
            tests: { status: "skipped", details: "not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 errors")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("2 errors")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("not run")).toBeDefined();
  });

  it("does not render a Checks section when checks is null/absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the files changed list and count", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("does not render Files Changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes as a markdown list", () => {
    render(<ExecutionReportView report={{ notes: ["Watch out for X"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Watch out for X")).toBeDefined();
  });

  it("shows 'Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft: Created/)).toBeDefined();
  });

  it("shows 'Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft: Not created/)).toBeDefined();
  });

  it("does not render the PR draft line when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });
});
