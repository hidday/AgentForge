import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("defaults executionVersion to 1 when absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders the score bar in the done color at or above 0.7", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.9, scoreRationale: "Great" }} />);
    expect(screen.getByText("Score: 90%")).toBeDefined();
    expect(screen.getByText("Great")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders the score bar in the waiting color between 0.4 and 0.7", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders the score bar in the blocked color below 0.4", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the feature" }} />);
    expect(screen.getByText("Implemented the feature")).toBeDefined();
  });

  it("renders checks with pass/fail/other icon styling", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "clean" },
            typecheck: { status: "fail", details: "2 errors" },
            tests: { status: "skip", details: "not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("clean")).toBeDefined();
    expect(screen.getByText("2 errors")).toBeDefined();
  });

  it("renders the files changed list with a count", () => {
    render(<ExecutionReportView report={{ filesChanged: ["src/a.ts", "src/b.ts"] }} />);
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
  });

  it("renders notes as a bulleted markdown list", () => {
    render(<ExecutionReportView report={{ notes: ["Watch out for X"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Watch out for X")).toBeDefined();
  });

  it("shows whether a PR draft was created", () => {
    const { rerender } = render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText("PR Draft: Created")).toBeDefined();

    rerender(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText("PR Draft: Not created")).toBeDefined();
  });

  it("omits the PR draft line when prDraftCreated is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });
});
