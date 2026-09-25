import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders default version (v1) and no optional sections for an empty report", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });

  it("renders the given executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 4 }} />);
    expect(screen.getByText("v4")).toBeDefined();
  });

  it("renders the score bar and percentage with done color at high score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.85 }} />);
    expect(screen.getByText("Score: 85%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders the score bar with waiting color at mid score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders the score bar with blocked color at low score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(screen.getByText("Score: 20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders score rationale only when both score and rationale are present", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.9, scoreRationale: "All checks passed cleanly" }}
      />,
    );
    expect(screen.getByText("All checks passed cleanly")).toBeDefined();
  });

  it("does not render score rationale when score is missing even if rationale is present", () => {
    render(<ExecutionReportView report={{ scoreRationale: "Should not show" }} />);
    expect(screen.queryByText("Should not show")).toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the **feature**" }} />);
    expect(screen.getByText("feature", { selector: "strong" })).toBeDefined();
  });

  it("renders checks with pass status styling", () => {
    render(
      <ExecutionReportView
        report={{
          checks: { lint: { status: "pass", details: "0 errors" } },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 errors")).toBeDefined();
  });

  it("renders checks with fail status styling", () => {
    const { container } = render(
      <ExecutionReportView
        report={{
          checks: { tests: { status: "fail", details: "2 failing" } },
        }}
      />,
    );
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failing")).toBeDefined();
    expect(container.querySelector(".border-state-blocked\\/30")).not.toBeNull();
  });

  it("renders checks with a neutral/other status (not pass or fail)", () => {
    const { container } = render(
      <ExecutionReportView
        report={{
          checks: { typecheck: { status: "skipped", details: "not run" } },
        }}
      />,
    );
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(container.querySelector(".border-border-subtle.bg-surface")).not.toBeNull();
  });

  it("renders multiple files changed with a count", () => {
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

  it("does not render Files Changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes as a markdown list", () => {
    render(<ExecutionReportView report={{ notes: ["First note", "Second note"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("First note")).toBeDefined();
    expect(screen.getByText("Second note")).toBeDefined();
  });

  it("renders 'PR Draft: Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:/)).toBeDefined();
    expect(screen.getByText(/Created/)).toBeDefined();
  });

  it("renders 'PR Draft: Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/Not created/)).toBeDefined();
  });

  it("renders a fully populated report end to end", () => {
    render(
      <ExecutionReportView
        report={{
          executionVersion: 2,
          score: 0.75,
          scoreRationale: "Solid overall",
          summary: "Summary of work",
          checks: { lint: { status: "pass", details: "clean" } },
          filesChanged: ["src/x.ts"],
          notes: ["A note"],
          prDraftCreated: true,
        }}
      />,
    );
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Score: 75%")).toBeDefined();
    expect(screen.getByText("Solid overall")).toBeDefined();
    expect(screen.getByText("Summary of work")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("src/x.ts")).toBeDefined();
    expect(screen.getByText("A note")).toBeDefined();
    expect(screen.getByText(/Created/)).toBeDefined();
  });
});
