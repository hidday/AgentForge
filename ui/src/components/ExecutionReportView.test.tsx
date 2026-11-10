import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("ExecutionReportView", () => {
  it("renders the default version (v1) and no optional sections for an empty report", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });

  it("renders the explicit execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 4 }} />);
    expect(screen.getByText("v4")).toBeDefined();
  });

  it("renders the score bar and percentage with done styling for a high score", () => {
    const { container } = render(
      <ExecutionReportView report={{ score: 0.9 }} />,
    );
    expect(screen.getByText("Score: 90%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders the score bar with waiting styling for a mid-range score", () => {
    const { container } = render(
      <ExecutionReportView report={{ score: 0.5 }} />,
    );
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders the score bar with blocked styling for a low score", () => {
    const { container } = render(
      <ExecutionReportView report={{ score: 0.1 }} />,
    );
    expect(screen.getByText("Score: 10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the score rationale only when both score and rationale are present", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.8, scoreRationale: "Covers all acceptance criteria." }}
      />,
    );
    expect(
      screen.getByText("Covers all acceptance criteria."),
    ).toBeDefined();
  });

  it("does not render score rationale when score is absent even if rationale text is given", () => {
    render(
      <ExecutionReportView report={{ scoreRationale: "Orphan rationale" }} />,
    );
    expect(screen.queryByText("Orphan rationale")).toBeNull();
  });

  it("renders the summary through Markdown", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the feature." }} />);
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(
      markdownEls.some((el) => el.textContent === "Implemented the feature."),
    ).toBe(true);
  });

  it("renders checks with pass/fail/other icons and statuses", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "No issues." },
            tests: { status: "fail", details: "2 tests failed." },
            typecheck: { status: "skipped", details: "Not run." },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("No issues.")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 tests failed.")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("Not run.")).toBeDefined();
  });

  it("does not render the Checks section when checks is null", () => {
    render(<ExecutionReportView report={{ checks: null }} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the files changed list with a count", () => {
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

  it("renders notes through Markdown", () => {
    render(
      <ExecutionReportView
        report={{ notes: ["Remember to update the changelog."] }}
      />,
    );
    expect(screen.getByText("Notes")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(
      markdownEls.some(
        (el) => el.textContent === "Remember to update the changelog.",
      ),
    ).toBe(true);
  });

  it("does not render the Notes section when notes is empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("shows 'Created' for PR draft when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:/).textContent).toContain("Created");
  });

  it("shows 'Not created' for PR draft when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft:/).textContent).toContain("Not created");
  });

  it("omits the PR draft row when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });

  it("renders a fully populated report with every section at once", () => {
    render(
      <ExecutionReportView
        report={{
          executionVersion: 3,
          score: 0.75,
          scoreRationale: "Solid coverage.",
          summary: "All acceptance criteria met.",
          checks: { lint: { status: "pass", details: "clean" } },
          filesChanged: ["src/index.ts"],
          notes: ["One note."],
          prDraftCreated: true,
        }}
      />,
    );
    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("Score: 75%")).toBeDefined();
    expect(screen.getByText("Solid coverage.")).toBeDefined();
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("Files Changed (1)")).toBeDefined();
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText(/PR Draft:/).textContent).toContain("Created");
  });
});
