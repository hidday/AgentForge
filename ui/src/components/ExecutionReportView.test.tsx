import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the default version (v1) when executionVersion is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders the explicit execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 2 }} />);
    expect(screen.getByText("v2")).toBeDefined();
  });

  it("renders the score bar and percentage with done styling at high score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(screen.getByText("Score: 90%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders waiting styling for mid score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders blocked styling for low score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(screen.getByText("Score: 10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("does not render the score bar when score is null/undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/Score:/)).toBeNull();
  });

  it("renders score rationale only when both score and rationale are present", () => {
    render(
      <ExecutionReportView report={{ score: 0.8, scoreRationale: "Solid implementation" }} />,
    );
    expect(screen.getByText("Solid implementation")).toBeDefined();
  });

  it("does not render score rationale when score is missing even if rationale present", () => {
    render(<ExecutionReportView report={{ scoreRationale: "orphan rationale" }} />);
    expect(screen.queryByText("orphan rationale")).toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the feature" }} />);
    expect(screen.getByText("Implemented the feature")).toBeDefined();
  });

  it("renders checks with pass/fail/other statuses and their details", () => {
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

  it("does not render the checks section when checks is null", () => {
    render(<ExecutionReportView report={{ checks: null }} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the files changed list with count", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("does not render the files changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes as markdown list items", () => {
    render(<ExecutionReportView report={{ notes: ["Note one", "Note two"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Note one")).toBeDefined();
    expect(screen.getByText("Note two")).toBeDefined();
  });

  it("does not render the notes section when the list is empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("shows PR Draft: Created when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:/)).toBeDefined();
    expect(screen.getByText(/Created/)).toBeDefined();
  });

  it("shows PR Draft: Not created when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/Not created/)).toBeDefined();
  });

  it("does not render the PR draft line when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });
});
