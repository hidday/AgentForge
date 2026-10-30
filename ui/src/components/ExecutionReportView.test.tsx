import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders default version 1 when executionVersion is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders explicit executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 4 }} />);
    expect(screen.getByText("v4")).toBeDefined();
  });

  it("renders nothing in optional sections when report has no optional fields", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/^Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft/)).toBeNull();
    expect(screen.queryByText(/Score:/)).toBeNull();
  });

  it("renders summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "Execution summary" }} />);
    expect(screen.getByText("Execution summary")).toBeDefined();
  });

  it("renders score bar and rationale for score >= 0.7 (done)", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.9, scoreRationale: "Great implementation" }}
      />,
    );
    expect(screen.getByText("Score: 90%")).toBeDefined();
    expect(screen.getByText("Great implementation")).toBeDefined();
  });

  it("renders score bar for score between 0.4 and 0.7 (waiting)", () => {
    render(<ExecutionReportView report={{ score: 0.55 }} />);
    expect(screen.getByText("Score: 55%")).toBeDefined();
  });

  it("renders score bar for score below 0.4 (blocked)", () => {
    render(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(screen.getByText("Score: 10%")).toBeDefined();
  });

  it("does not render rationale text when score is present but scoreRationale is absent", () => {
    render(<ExecutionReportView report={{ score: 0.8 }} />);
    expect(screen.getByText("Score: 80%")).toBeDefined();
  });

  it("renders checks grid with pass, fail, and other statuses", () => {
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

  it("renders files changed list with count", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("renders notes list", () => {
    render(<ExecutionReportView report={{ notes: ["Note one", "Note two"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Note one")).toBeDefined();
    expect(screen.getByText("Note two")).toBeDefined();
  });

  it("renders 'Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:\s*Created/)).toBeDefined();
  });

  it("renders 'Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft:\s*Not created/)).toBeDefined();
  });
});
