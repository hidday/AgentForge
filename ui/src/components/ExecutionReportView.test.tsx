import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("defaults to version 1 when executionVersion is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders the given executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 5 }} />);
    expect(screen.getByText("v5")).toBeDefined();
  });

  it("does not render a score bar or rationale when score is absent", () => {
    const { container } = render(
      <ExecutionReportView report={{ scoreRationale: "irrelevant without score" }} />,
    );
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(container.querySelector(".h-1\\.5.w-24")).toBeNull();
  });

  it("renders the score bar and percentage, colored green for a high score", () => {
    const { container } = render(
      <ExecutionReportView report={{ score: 0.85, scoreRationale: "Clean implementation" }} />,
    );
    expect(screen.getByText("Score: 85%")).toBeDefined();
    expect(screen.getByText("Clean implementation")).toBeDefined();
    const bar = container.querySelector(".bg-state-done");
    expect(bar).not.toBeNull();
  });

  it("colors the score bar amber for a mid-range score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("colors the score bar red for a low score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(screen.getByText("Score: 20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("does not render a rationale line when score is present but rationale is absent", () => {
    render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(screen.getByText("Score: 90%")).toBeDefined();
  });

  it("renders the summary as markdown content", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the **feature**." }} />);
    expect(screen.getByText(/Implemented the/)).toBeDefined();
  });

  it("does not render a summary section when summary is absent", () => {
    const { container } = render(<ExecutionReportView report={{}} />);
    expect(container.textContent).not.toContain("Implemented");
  });

  it("renders a Checks grid with pass/fail/other statuses and details", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "no issues" },
            typecheck: { status: "fail", details: "2 errors" },
            tests: { status: "skipped", details: "not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("no issues")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("2 errors")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("not run")).toBeDefined();
  });

  it("does not render the Checks section when checks is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the Files Changed section with a count and each file", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts", "src/c.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (3)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
    expect(screen.getByText("src/c.ts")).toBeDefined();
  });

  it("does not render the Files Changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders Notes as a list of markdown items", () => {
    render(
      <ExecutionReportView
        report={{ notes: ["Remember to update docs", "Follow up on perf"] }}
      />,
    );
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Remember to update docs")).toBeDefined();
    expect(screen.getByText("Follow up on perf")).toBeDefined();
  });

  it("does not render Notes when the list is empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it('shows "PR Draft: Created" when prDraftCreated is true', () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText("PR Draft: Created")).toBeDefined();
  });

  it('shows "PR Draft: Not created" when prDraftCreated is false', () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText("PR Draft: Not created")).toBeDefined();
  });

  it("does not render the PR draft line when prDraftCreated is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });

  it("renders a fully populated report with all sections together", () => {
    render(
      <ExecutionReportView
        report={{
          executionVersion: 2,
          score: 0.75,
          scoreRationale: "Solid coverage",
          summary: "All changes applied successfully.",
          checks: { lint: { status: "pass", details: "ok" } },
          filesChanged: ["src/index.ts"],
          notes: ["Nothing else to flag"],
          prDraftCreated: true,
        }}
      />,
    );

    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Score: 75%")).toBeDefined();
    expect(screen.getByText("Solid coverage")).toBeDefined();
    expect(screen.getByText(/All changes applied successfully/)).toBeDefined();
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("Files Changed (1)")).toBeDefined();
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("PR Draft: Created")).toBeDefined();
  });
});
