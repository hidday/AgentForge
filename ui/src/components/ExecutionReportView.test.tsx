import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the default version (v1) and no optional sections for an empty report", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });

  it("renders a full report: score, checks, files, notes, and PR draft status", () => {
    const report = {
      executionVersion: 2,
      summary: "Executed the plan successfully.",
      score: 0.9,
      scoreRationale: "All checks passed.",
      checks: {
        lint: { status: "pass", details: "0 errors" },
        tests: { status: "fail", details: "2 failing" },
        typecheck: { status: "skipped", details: "n/a" },
      },
      filesChanged: ["src/a.ts", "src/b.ts"],
      notes: ["Note one", "Note two"],
      prDraftCreated: true,
    };
    const { container } = render(<ExecutionReportView report={report} />);

    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Score: 90%")).toBeDefined();
    expect(screen.getByText("All checks passed.")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();

    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("0 errors")).toBeDefined();
    expect(screen.getByText("2 failing")).toBeDefined();

    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();

    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("PR Draft: Created")).toBeDefined();

    const markdownBlocks = screen.getAllByTestId("markdown");
    // summary + 2 notes
    expect(markdownBlocks.length).toBe(3);
  });

  it("colors the score bar by threshold: medium (0.4-0.7) uses the waiting color", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("colors the score bar by threshold: low (<0.4) uses the blocked color", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("does not render the score rationale when score is absent even if rationale is present", () => {
    render(<ExecutionReportView report={{ scoreRationale: "orphan rationale" }} />);
    expect(screen.queryByText("orphan rationale")).toBeNull();
  });

  it("shows 'Not created' when prDraftCreated is explicitly false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText("PR Draft: Not created")).toBeDefined();
  });

  it("renders fail-status checks with the blocked styling", () => {
    const { container } = render(
      <ExecutionReportView
        report={{ checks: { tests: { status: "fail", details: "boom" } } }}
      />,
    );
    expect(container.querySelector(".border-state-blocked\\/30")).not.toBeNull();
  });

  it("renders a check with an unrecognized status using the neutral/skipped styling", () => {
    const { container } = render(
      <ExecutionReportView
        report={{ checks: { typecheck: { status: "skipped", details: "n/a" } } }}
      />,
    );
    expect(container.querySelector(".border-border-subtle")).not.toBeNull();
  });

  it("renders nothing for filesChanged/notes when the arrays are empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [], notes: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
  });
});
