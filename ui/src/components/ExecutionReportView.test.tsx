import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("defaults executionVersion to 1 when absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders an explicit executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 2 }} />);
    expect(screen.getByText("v2")).toBeDefined();
  });

  it("renders the score bar and percentage, and the rationale beneath it", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.75, scoreRationale: "All checks passed cleanly." }}
      />,
    );
    expect(screen.getByText("Score: 75%")).toBeDefined();
    expect(screen.getByText("All checks passed cleanly.")).toBeDefined();
  });

  it("omits the score bar entirely when score is not provided", () => {
    render(<ExecutionReportView report={{ scoreRationale: "should not show" }} />);
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("uses done styling for score >= 0.7", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.8 }} />);
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("uses waiting styling for score between 0.4 and 0.7", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.55 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("uses blocked styling for score below 0.4", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the feature." }} />);
    expect(screen.getByText("Implemented the feature.")).toBeDefined();
  });

  it("renders checks with pass/fail/other statuses and their details", () => {
    const { container } = render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 problems" },
            typecheck: { status: "fail", details: "2 errors" },
            tests: { status: "skipped", details: "not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 problems")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("2 errors")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("not run")).toBeDefined();
    expect(container.querySelector(".border-state-done\\/30")).not.toBeNull();
    expect(container.querySelector(".border-state-blocked\\/30")).not.toBeNull();
    expect(container.querySelector(".border-border-subtle")).not.toBeNull();
  });

  it("omits the Checks section when checks is null/absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the files changed list with a count heading", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("omits the files changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes as a bulleted markdown list", () => {
    render(
      <ExecutionReportView
        report={{ notes: ["Watch out for flaky test X.", "Follow-up needed on Y."] }}
      />,
    );
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Watch out for flaky test X.")).toBeDefined();
    expect(screen.getByText("Follow-up needed on Y.")).toBeDefined();
  });

  it("omits the notes section when empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("shows 'Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:/)).toBeDefined();
    expect(screen.getByText(/Created/)).toBeDefined();
  });

  it("shows 'Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/Not created/)).toBeDefined();
  });

  it("omits the PR draft line entirely when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });
});
