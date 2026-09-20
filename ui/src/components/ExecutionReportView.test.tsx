import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("ExecutionReportView", () => {
  it("renders a fully populated report", () => {
    const report = {
      executionVersion: 3,
      summary: "Implemented the feature end to end.",
      filesChanged: ["src/foo.ts", "src/bar.ts"],
      checks: {
        lint: { status: "pass", details: "0 problems" },
        typecheck: { status: "fail", details: "2 errors" },
        tests: { status: "skipped", details: "not run" },
      },
      notes: ["Watch out for the retry logic.", "Follow-up needed on caching."],
      prDraftCreated: true,
      score: 0.85,
      scoreRationale: "Solid coverage of the acceptance criteria.",
    };

    render(<ExecutionReportView report={report} />);

    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("Score: 85%")).toBeDefined();
    expect(
      screen.getByText("Solid coverage of the acceptance criteria."),
    ).toBeDefined();
    expect(screen.getByTestId("markdown-content").textContent).toContain(
      "Implemented the feature end to end.",
    );

    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 problems")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("2 errors")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("not run")).toBeDefined();

    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/foo.ts")).toBeDefined();
    expect(screen.getByText("src/bar.ts")).toBeDefined();

    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Watch out for the retry logic.")).toBeDefined();
    expect(screen.getByText("Follow-up needed on caching.")).toBeDefined();

    expect(screen.getByText(/PR Draft: Created/)).toBeDefined();
  });

  it("defaults to version 1 and omits optional sections when the report is minimal", () => {
    render(<ExecutionReportView report={{}} />);

    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
    expect(screen.queryByTestId("markdown-content")).toBeNull();
  });

  it("shows 'PR Draft: Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);

    expect(screen.getByText(/PR Draft: Not created/)).toBeDefined();
  });

  it("does not render the score rationale block when score is missing even if rationale text is present", () => {
    render(
      <ExecutionReportView
        report={{ scoreRationale: "orphaned rationale with no score" }}
      />,
    );

    expect(screen.queryByText("orphaned rationale with no score")).toBeNull();
  });

  it("colors a low score as blocked and a mid score as waiting", () => {
    const { container: lowContainer } = render(
      <ExecutionReportView report={{ score: 0.2 }} />,
    );
    expect(lowContainer.querySelector(".bg-state-blocked")).not.toBeNull();

    const { container: midContainer } = render(
      <ExecutionReportView report={{ score: 0.5 }} />,
    );
    expect(midContainer.querySelector(".bg-state-waiting")).not.toBeNull();
  });
});
