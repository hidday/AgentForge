import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the default version and no optional sections for a minimal report", () => {
    render(<ExecutionReportView report={{}} />);

    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.queryByText(/Score:/i)).toBeNull();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/i)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft:/i)).toBeNull();
  });

  it("uses the given executionVersion and renders a done-colored score bar for score >= 0.7", () => {
    render(<ExecutionReportView report={{ executionVersion: 2, score: 0.85 }} />);

    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Score: 85%")).toBeDefined();
    const fill = document.querySelector(".bg-state-done");
    expect(fill).not.toBeNull();
    expect((fill as HTMLElement).style.width).toBe("85%");
  });

  it("renders a waiting-colored score bar for mid-range scores and shows rationale", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.5, scoreRationale: "Some checks were skipped." }}
      />,
    );

    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(document.querySelector(".bg-state-waiting")).not.toBeNull();
    expect(screen.getByText("Some checks were skipped.")).toBeDefined();
  });

  it("renders a blocked-colored score bar for low scores", () => {
    render(<ExecutionReportView report={{ score: 0.2 }} />);

    expect(screen.getByText("Score: 20%")).toBeDefined();
    expect(document.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("does not render the rationale text when score is absent even if scoreRationale is set", () => {
    render(<ExecutionReportView report={{ scoreRationale: "Orphan rationale" }} />);

    expect(screen.queryByText("Orphan rationale")).toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the feature." }} />);

    expect(screen.getByText("Implemented the feature.")).toBeDefined();
  });

  it("renders each check with pass/fail/other icon-driven styling", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 problems" },
            tests: { status: "fail", details: "2 failing" },
            typecheck: { status: "skipped", details: "not run" },
          },
        }}
      />,
    );

    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 problems")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failing")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("not run")).toBeDefined();
  });

  it("renders the files-changed list with a count", () => {
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

  it("shows PR Draft: Created when prDraftCreated is true", () => {
    const { container } = render(
      <ExecutionReportView report={{ prDraftCreated: true }} />,
    );

    expect(container.textContent).toContain("PR Draft: Created");
  });

  it("shows PR Draft: Not created when prDraftCreated is false", () => {
    const { container } = render(
      <ExecutionReportView report={{ prDraftCreated: false }} />,
    );

    expect(container.textContent).toContain("PR Draft: Not created");
  });
});
