import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

vi.mock("./Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("ExecutionReportView", () => {
  it("renders the default version and omits all optional sections for a minimal report", () => {
    const { container } = render(<ExecutionReportView report={{}} />);

    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
    expect(container.querySelector("[data-testid='markdown-content']")).toBeNull();
  });

  it("renders a custom executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders the score bar with a done color and percentage for a high score", () => {
    const { container } = render(
      <ExecutionReportView report={{ score: 0.85, scoreRationale: "Strong coverage" }} />,
    );

    expect(screen.getByText("Score: 85%")).toBeDefined();
    expect(screen.getByText("Strong coverage")).toBeDefined();
    const bar = container.querySelector(".bg-state-done");
    expect(bar).not.toBeNull();
  });

  it("renders the score bar with a warning color for a mid-range score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    const bar = container.querySelector(".bg-state-waiting");
    expect(bar).not.toBeNull();
  });

  it("renders the score bar with a blocked color for a low score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(screen.getByText("Score: 20%")).toBeDefined();
    const bar = container.querySelector(".bg-state-blocked");
    expect(bar).not.toBeNull();
  });

  it("does not render score rationale when score is present but rationale is missing", () => {
    render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(screen.getByText("Score: 90%")).toBeDefined();
  });

  it("does not render the score bar or rationale when score is absent even if rationale is set", () => {
    render(<ExecutionReportView report={{ scoreRationale: "orphan rationale" }} />);
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText("orphan rationale")).toBeNull();
  });

  it("renders the summary through Markdown when present", () => {
    render(<ExecutionReportView report={{ summary: "## Summary\nAll good." }} />);
    const md = screen.getByTestId("markdown-content");
    expect(md.textContent).toContain("All good.");
  });

  it("renders each check with pass/fail/other status icons and details", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 problems" },
            typecheck: { status: "fail", details: "2 errors" },
            build: { status: "skipped", details: "not run" },
          },
        }}
      />,
    );

    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 problems")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("2 errors")).toBeDefined();
    expect(screen.getByText("build")).toBeDefined();
    expect(screen.getByText("not run")).toBeDefined();
  });

  it("does not render the Checks section when checks is null", () => {
    render(<ExecutionReportView report={{ checks: null }} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the files changed list with a count when non-empty", () => {
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

  it("renders notes as a bulleted list of Markdown blocks when present", () => {
    render(
      <ExecutionReportView
        report={{ notes: ["First note", "Second note"] }}
      />,
    );

    expect(screen.getByText("Notes")).toBeDefined();
    const mdBlocks = screen.getAllByTestId("markdown-content");
    expect(mdBlocks.map((el) => el.textContent)).toEqual(["First note", "Second note"]);
  });

  it("does not render the Notes section when notes is empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it('shows "Created" when prDraftCreated is true', () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:/)).toBeDefined();
    expect(screen.getByText(/Created/)).toBeDefined();
  });

  it('shows "Not created" when prDraftCreated is false', () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/Not created/)).toBeDefined();
  });

  it("omits the PR draft line entirely when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });

  it("renders a fully populated report with every section present", () => {
    render(
      <ExecutionReportView
        report={{
          executionVersion: 2,
          score: 0.72,
          scoreRationale: "All checks passed with minor caveats",
          summary: "Implemented the feature end to end.",
          checks: { tests: { status: "pass", details: "42/42" } },
          filesChanged: ["src/feature.ts"],
          notes: ["Follow-up needed for edge case X"],
          prDraftCreated: true,
        }}
      />,
    );

    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Score: 72%")).toBeDefined();
    expect(screen.getByText("All checks passed with minor caveats")).toBeDefined();
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("Files Changed (1)")).toBeDefined();
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText(/Created/)).toBeDefined();
  });
});
