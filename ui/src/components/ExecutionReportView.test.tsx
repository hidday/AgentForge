import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the version and nothing else when the report is otherwise empty", () => {
    const { container } = render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
    expect(container.querySelector(".h-1\\.5")).toBeNull(); // no score bar
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });

  it("uses the given executionVersion instead of the default", () => {
    render(<ExecutionReportView report={{ executionVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders a green score bar and percentage for a high score", () => {
    render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(screen.getByText("Score: 90%")).toBeDefined();
    const fill = document.querySelector(".bg-state-done");
    expect(fill).not.toBeNull();
    expect((fill as HTMLElement).style.width).toBe("90%");
  });

  it("renders a yellow/waiting score bar for a mid-range score", () => {
    render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(document.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a red/blocked score bar for a low score", () => {
    render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(screen.getByText("Score: 20%")).toBeDefined();
    expect(document.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the score rationale only alongside a score", () => {
    render(
      <ExecutionReportView
        report={{ scoreRationale: "Looks solid, minor gaps in tests." }}
      />,
    );
    expect(
      screen.queryByText("Looks solid, minor gaps in tests."),
    ).toBeNull();

    render(
      <ExecutionReportView
        report={{ score: 0.8, scoreRationale: "Looks solid." }}
      />,
    );
    expect(screen.getByText("Looks solid.")).toBeDefined();
  });

  it("renders the summary as markdown", () => {
    render(
      <ExecutionReportView report={{ summary: "**Done**: wired up auth." }} />,
    );
    expect(screen.getByText("Done")).toBeDefined();
    expect(screen.getByText(/wired up auth/)).toBeDefined();
  });

  it("renders a grid of checks with pass/fail/skip icons and styling", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "clean" },
            tests: { status: "fail", details: "2 failing" },
            typecheck: { status: "skip", details: "n/a" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("clean")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failing")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("n/a")).toBeDefined();

    const lintCard = screen.getByText("lint").closest("div.rounded");
    expect(lintCard?.className).toContain("border-state-done/30");
    const testsCard = screen.getByText("tests").closest("div.rounded");
    expect(testsCard?.className).toContain("border-state-blocked/30");
    const typecheckCard = screen.getByText("typecheck").closest("div.rounded");
    expect(typecheckCard?.className).toContain("border-border-subtle");
  });

  it("renders the files-changed list with a count", () => {
    render(
      <ExecutionReportView
        report={{
          filesChanged: ["src/a.ts", "src/b.ts"],
        }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("does not render the files-changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes as a bulleted markdown list", () => {
    render(
      <ExecutionReportView
        report={{ notes: ["First note", "Second note"] }}
      />,
    );
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("First note")).toBeDefined();
    expect(screen.getByText("Second note")).toBeDefined();
  });

  it("shows 'Created' when prDraftCreated is true and 'Not created' when false", () => {
    const { rerender } = render(
      <ExecutionReportView report={{ prDraftCreated: true }} />,
    );
    expect(screen.getByText(/PR Draft:\s*Created/)).toBeDefined();

    rerender(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft:\s*Not created/)).toBeDefined();
  });
});
