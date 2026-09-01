import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

// Mock the Markdown component so ExecutionReportView tests are isolated from react-markdown internals
import { vi } from "vitest";
vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("ExecutionReportView", () => {
  it("renders the default version (v1) when executionVersion is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders a custom executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 4 }} />);
    expect(screen.getByText("v4")).toBeDefined();
  });

  it("renders the score bar and percentage with done color when >= 0.7", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.8 }} />);
    expect(screen.getByText("Score: 80%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders the score bar with waiting color when between 0.4 and 0.7", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders the score bar with blocked color when below 0.4", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(screen.getByText("Score: 10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("does not render the score bar when score is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/^Score:/)).toBeNull();
  });

  it("renders the score rationale only when both score and scoreRationale are present", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.6, scoreRationale: "Tests pass but coverage is thin." }}
      />,
    );
    expect(screen.getByText("Tests pass but coverage is thin.")).toBeDefined();
  });

  it("does not render the score rationale when score is absent even if scoreRationale is present", () => {
    render(<ExecutionReportView report={{ scoreRationale: "should not show" }} />);
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the summary through Markdown when present", () => {
    render(<ExecutionReportView report={{ summary: "Execution summary text." }} />);
    expect(screen.getByText("Execution summary text.")).toBeDefined();
  });

  it("does not render a summary section when absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryAllByTestId("markdown-content").length).toBe(0);
  });

  it("renders checks with pass/fail/other statuses and appropriate styling", () => {
    const { container } = render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "No issues" },
            typecheck: { status: "fail", details: "2 errors" },
            build: { status: "skipped", details: "Not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("No issues")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("2 errors")).toBeDefined();
    expect(screen.getByText("build")).toBeDefined();
    expect(screen.getByText("Not run")).toBeDefined();
    expect(container.querySelector(".border-state-done\\/30")).not.toBeNull();
    expect(container.querySelector(".border-state-blocked\\/30")).not.toBeNull();
    expect(container.querySelector(".border-border-subtle.bg-surface")).not.toBeNull();
  });

  it("does not render the Checks section when checks is null", () => {
    render(<ExecutionReportView report={{ checks: null }} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders files changed with a count and file list", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("does not render the Files Changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes as a bulleted list through Markdown", () => {
    render(<ExecutionReportView report={{ notes: ["Note one", "Note two"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Note one")).toBeDefined();
    expect(screen.getByText("Note two")).toBeDefined();
  });

  it("does not render the Notes section when notes is empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("shows 'PR Draft: Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:/)).toBeDefined();
    expect(screen.getByText(/Created/)).toBeDefined();
  });

  it("shows 'PR Draft: Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/Not created/)).toBeDefined();
  });

  it("does not render the PR draft row when prDraftCreated is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });

  it("renders a fully populated report end to end", () => {
    render(
      <ExecutionReportView
        report={{
          executionVersion: 2,
          score: 0.95,
          scoreRationale: "Excellent coverage and clean diff.",
          summary: "All good.",
          checks: { tests: { status: "pass", details: "All green" } },
          filesChanged: ["src/x.ts"],
          notes: ["Nothing else to add"],
          prDraftCreated: true,
        }}
      />,
    );
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Score: 95%")).toBeDefined();
    expect(screen.getByText("Excellent coverage and clean diff.")).toBeDefined();
    expect(screen.getByText("All good.")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("src/x.ts")).toBeDefined();
    expect(screen.getByText("Nothing else to add")).toBeDefined();
    expect(screen.getByText(/Created/)).toBeDefined();
  });
});
