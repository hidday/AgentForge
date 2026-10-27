import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("defaults the version to v1 when executionVersion is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders a custom execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 2 }} />);
    expect(screen.getByText("v2")).toBeDefined();
  });

  it("renders the score bar and percentage when score is set", () => {
    render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(screen.getByText("Score: 90%")).toBeDefined();
  });

  it("omits the score row when score is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/^Score:/)).toBeNull();
  });

  it("renders score rationale only alongside a score", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.5, scoreRationale: "Tests pass but coverage is thin." }}
      />,
    );
    expect(screen.getByText("Tests pass but coverage is thin.")).toBeDefined();
  });

  it("does not render rationale text when score is absent, even if scoreRationale is set", () => {
    render(<ExecutionReportView report={{ scoreRationale: "orphaned" }} />);
    expect(screen.queryByText("orphaned")).toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the feature." }} />);
    expect(screen.getByText("Implemented the feature.")).toBeDefined();
  });

  it("renders checks with pass/fail/other icons and details", () => {
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

  it("does not render a Checks section when checks is null/absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the list of files changed with a count", () => {
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
    expect(screen.queryByText(/^Files Changed/)).toBeNull();
  });

  it("renders notes as markdown bullets", () => {
    render(<ExecutionReportView report={{ notes: ["Watch out for X."] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Watch out for X.")).toBeDefined();
  });

  it("renders 'Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText((text) => text.includes("PR Draft:") && text.includes("Created"))).toBeDefined();
  });

  it("renders 'Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(
      screen.getByText((text) => text.includes("PR Draft:") && text.includes("Not created")),
    ).toBeDefined();
  });

  it("omits the PR draft row when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });
});
