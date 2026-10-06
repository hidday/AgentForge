import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the default version (v1) when executionVersion is missing", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders a custom execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 4 }} />);
    expect(screen.getByText("v4")).toBeDefined();
  });

  it("renders no score bar or rationale when score is undefined", () => {
    const { container } = render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(container.querySelector(".italic")).toBeNull();
  });

  it("renders the score bar colored green and percentage for high score, plus rationale", () => {
    const { container } = render(
      <ExecutionReportView
        report={{ score: 0.9, scoreRationale: "All checks passed cleanly." }}
      />,
    );
    expect(screen.getByText("Score: 90%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
    expect(screen.getByText("All checks passed cleanly.")).toBeDefined();
  });

  it("colors the score bar yellow for a mid score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("colors the score bar red for a low score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(screen.getByText("Score: 20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("does not render rationale text when score is present but scoreRationale is missing", () => {
    render(<ExecutionReportView report={{ score: 0.8 }} />);
    expect(screen.getByText("Score: 80%")).toBeDefined();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "### Done\nAll good." }} />);
    expect(screen.getByRole("heading", { level: 3 })).toBeDefined();
    expect(screen.getByText("All good.")).toBeDefined();
  });

  it("renders checks with pass/fail/other statuses and their details", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "No issues" },
            tests: { status: "fail", details: "2 failing" },
            typecheck: { status: "skipped", details: "Not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("No issues")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failing")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("Not run")).toBeDefined();
  });

  it("does not render the Checks section when checks is null/absent", () => {
    render(<ExecutionReportView report={{}} />);
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

  it("does not render the Files Changed section for an empty array", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes as a bulleted markdown list", () => {
    render(<ExecutionReportView report={{ notes: ["Note one", "Note two"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Note one")).toBeDefined();
    expect(screen.getByText("Note two")).toBeDefined();
  });

  it("does not render the Notes section for an empty array", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("renders 'PR Draft: Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText("PR Draft: Created")).toBeDefined();
  });

  it("renders 'PR Draft: Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText("PR Draft: Not created")).toBeDefined();
  });

  it("does not render the PR draft row when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });
});
