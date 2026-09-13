import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("defaults executionVersion to 1 and omits optional sections for an empty report", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });

  it("renders the given executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 5 }} />);
    expect(screen.getByText("v5")).toBeDefined();
  });

  it("renders score bar with done color for score >= 0.7", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.75 }} />);
    expect(screen.getByText("Score: 75%")).toBeDefined();
    const bar = container.querySelector(".bg-state-done");
    expect(bar).not.toBeNull();
    expect((bar as HTMLElement).style.width).toBe("75%");
  });

  it("renders score bar with waiting color for score between 0.4 and 0.7", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.55 }} />);
    expect(screen.getByText("Score: 55%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders score bar with blocked color for score < 0.4", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(screen.getByText("Score: 10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders scoreRationale only when score is also present", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.8, scoreRationale: "High confidence due to full test coverage" }}
      />,
    );
    expect(
      screen.getByText("High confidence due to full test coverage"),
    ).toBeDefined();
  });

  it("does not render scoreRationale when score is absent even if rationale text exists", () => {
    render(
      <ExecutionReportView report={{ scoreRationale: "should not show" }} />,
    );
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "**Done** successfully" }} />);
    const strong = screen.getByText("Done");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renders checks grid with pass/fail/other icons and styling", () => {
    const report = {
      checks: {
        lint: { status: "pass", details: "No issues" },
        tests: { status: "fail", details: "2 failing" },
        typecheck: { status: "skipped", details: "Not run" },
      },
    };
    const { container } = render(<ExecutionReportView report={report} />);
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("No issues")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failing")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("Not run")).toBeDefined();

    expect(container.querySelector(".border-state-done\\/30")).not.toBeNull();
    expect(container.querySelector(".border-state-blocked\\/30")).not.toBeNull();
    expect(container.querySelector(".border-border-subtle.bg-surface")).not.toBeNull();
  });

  it("does not render Checks section when checks is null/absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the files changed list with count", () => {
    const report = { filesChanged: ["src/a.ts", "src/b.ts"] };
    render(<ExecutionReportView report={report} />);
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("does not render Files Changed section when array is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes list via markdown", () => {
    const report = { notes: ["Note one", "Note *two*"] };
    render(<ExecutionReportView report={report} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Note one")).toBeDefined();
    expect(screen.getByText("two").tagName).toBe("EM");
  });

  it("does not render Notes section when notes array is empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("shows 'Created' for PR draft when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    const line = screen.getByText(/PR Draft:/);
    expect(line.textContent).toBe("PR Draft: Created");
  });

  it("shows 'Not created' for PR draft when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    const line = screen.getByText(/PR Draft:/);
    expect(line.textContent).toBe("PR Draft: Not created");
  });

  it("does not render PR draft line when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });

  it("renders a fully populated report with all sections together", () => {
    const report = {
      executionVersion: 3,
      score: 0.9,
      scoreRationale: "All checks passed",
      summary: "Execution summary",
      checks: { lint: { status: "pass", details: "clean" } },
      filesChanged: ["file1.ts"],
      notes: ["a note"],
      prDraftCreated: true,
    };
    render(<ExecutionReportView report={report} />);
    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("Score: 90%")).toBeDefined();
    expect(screen.getByText("All checks passed")).toBeDefined();
    expect(screen.getByText("Execution summary")).toBeDefined();
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("Files Changed (1)")).toBeDefined();
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText(/PR Draft:/).textContent).toBe("PR Draft: Created");
  });
});
