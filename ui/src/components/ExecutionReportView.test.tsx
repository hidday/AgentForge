import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders default version v1 for an empty report", () => {
    const { container } = render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
    expect(container.querySelector(".space-y-5")).not.toBeNull();
  });

  it("renders a custom executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 4 }} />);
    expect(screen.getByText("v4")).toBeDefined();
  });

  it("renders the score bar and percentage when score is present", () => {
    render(<ExecutionReportView report={{ score: 0.75 }} />);
    expect(screen.getByText("Score: 75%")).toBeDefined();
  });

  it("does not render a score bar when score is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/^Score:/)).toBeNull();
  });

  it("colors the score bar red below 0.4", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.1 }} />);
    const bar = container.querySelector(".h-full.rounded-full");
    expect(bar?.className).toContain("bg-state-blocked");
  });

  it("colors the score bar amber between 0.4 and 0.7", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    const bar = container.querySelector(".h-full.rounded-full");
    expect(bar?.className).toContain("bg-state-waiting");
  });

  it("colors the score bar green at or above 0.7", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.8 }} />);
    const bar = container.querySelector(".h-full.rounded-full");
    expect(bar?.className).toContain("bg-state-done");
  });

  it("renders the score rationale when both score and rationale are present", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.6, scoreRationale: "Tests pass but coverage low" }}
      />,
    );
    expect(screen.getByText("Tests pass but coverage low")).toBeDefined();
  });

  it("does not render rationale when score is absent even if rationale is present", () => {
    render(
      <ExecutionReportView report={{ scoreRationale: "Some rationale" }} />,
    );
    expect(screen.queryByText("Some rationale")).toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "**Done things**" }} />);
    const strong = screen.getByText("Done things");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renders checks with pass/fail/other icons and styling", () => {
    const report = {
      checks: {
        lint: { status: "pass", details: "No issues" },
        tests: { status: "fail", details: "2 failing" },
        typecheck: { status: "skipped", details: "N/A" },
      },
    };
    const { container } = render(<ExecutionReportView report={report} />);
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("No issues")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failing")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    // pass -> done styling, fail -> blocked styling, other -> neutral
    expect(container.querySelector(".border-state-done\\/30")).not.toBeNull();
    expect(container.querySelector(".border-state-blocked\\/30")).not.toBeNull();
    expect(container.querySelector(".border-border-subtle.bg-surface")).not.toBeNull();
  });

  it("does not render the Checks section when checks is null", () => {
    render(<ExecutionReportView report={{ checks: null }} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the files-changed list with a count", () => {
    const report = { filesChanged: ["src/a.ts", "src/b.ts"] };
    render(<ExecutionReportView report={report} />);
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("does not render the files-changed section when empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes as a bulleted markdown list", () => {
    const report = { notes: ["Note one", "Note two"] };
    render(<ExecutionReportView report={report} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Note one")).toBeDefined();
    expect(screen.getByText("Note two")).toBeDefined();
  });

  it("does not render the notes section when empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("shows PR Draft: Created when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft: Created/)).toBeDefined();
  });

  it("shows PR Draft: Not created when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft: Not created/)).toBeDefined();
  });

  it("does not render the PR draft line when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });
});
