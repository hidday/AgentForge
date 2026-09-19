import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("defaults the version to 1 and renders nothing else for an empty report", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.queryByText(/Score:/)).toBeNull();
  });

  it("renders the given executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders a high (green) score bar with rationale", () => {
    const { container } = render(
      <ExecutionReportView report={{ score: 0.9, scoreRationale: "Clean implementation." }} />,
    );
    expect(screen.getByText("Score: 90%")).toBeDefined();
    expect(screen.getByText("Clean implementation.")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders a medium (yellow) score bar", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a low (red) score bar", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(screen.getByText("Score: 10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("does not render score rationale when score is set but rationale is missing", () => {
    render(<ExecutionReportView report={{ score: 0.8 }} />);
    expect(screen.getByText("Score: 80%")).toBeDefined();
  });

  it("renders the summary via Markdown", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the feature." }} />);
    expect(screen.getByText("Implemented the feature.")).toBeDefined();
  });

  it("renders checks with pass/fail/other statuses and their details", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 problems" },
            test: { status: "fail", details: "2 failing" },
            typecheck: { status: "skipped", details: "not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 problems")).toBeDefined();
    expect(screen.getByText("test")).toBeDefined();
    expect(screen.getByText("2 failing")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
  });

  it("renders the list of changed files", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("renders notes as a markdown list", () => {
    render(<ExecutionReportView report={{ notes: ["Watch the migration."] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Watch the migration.")).toBeDefined();
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

  it("does not render the PR draft row when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });
});
