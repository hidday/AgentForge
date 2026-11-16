import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the default version v1 when executionVersion is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders a provided execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders the score bar, percentage, and rationale when score is present", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.9, scoreRationale: "All checks passed cleanly." }}
      />,
    );
    expect(screen.getByText("Score: 90%")).toBeDefined();
    expect(screen.getByText("All checks passed cleanly.")).toBeDefined();
  });

  it("does not render score section when score is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/Score:/)).toBeNull();
  });

  it("renders the summary via markdown", () => {
    render(<ExecutionReportView report={{ summary: "Implemented **feature X**." }} />);
    expect(screen.getByText("feature X").tagName).toBe("STRONG");
  });

  it("renders checks with pass/fail/skip status and details", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 errors" },
            typecheck: { status: "fail", details: "2 errors" },
            tests: { status: "skipped", details: "not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 errors")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("2 errors")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("not run")).toBeDefined();
  });

  it("does not render the Checks section when checks is null", () => {
    render(<ExecutionReportView report={{ checks: null }} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the files changed list with count", () => {
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

  it("does not render files changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes as a bulleted markdown list", () => {
    render(
      <ExecutionReportView
        report={{ notes: ["Watch out for `flaky` test", "Second note"] }}
      />,
    );
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("flaky").tagName).toBe("CODE");
    expect(screen.getByText("Second note")).toBeDefined();
  });

  it("renders 'Created' for prDraftCreated true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft: Created/)).toBeDefined();
  });

  it("renders 'Not created' for prDraftCreated false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft: Not created/)).toBeDefined();
  });

  it("does not render the PR draft line when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });

  it("applies blocked styling to a score below 0.4", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("applies waiting styling to a mid-range score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });
});
