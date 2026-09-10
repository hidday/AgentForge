import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView";

describe("ExecutionReportView", () => {
  it("renders the execution version, defaulting to 1", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders a provided execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 2 }} />);
    expect(screen.getByText("v2")).toBeDefined();
  });

  it("renders a high score with a done-colored bar and rationale", () => {
    const { container } = render(
      <ExecutionReportView report={{ score: 0.9, scoreRationale: "Solid work" }} />,
    );
    expect(screen.getByText("Score: 90%")).toBeDefined();
    expect(screen.getByText("Solid work")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders a medium score with a waiting-colored bar", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a low score with a blocked-colored bar", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "All done" }} />);
    expect(screen.getByText("All done")).toBeDefined();
  });

  it("renders passing, failing, and neutral checks with distinct styling", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 errors" },
            tests: { status: "fail", details: "2 failing" },
            typecheck: { status: "skipped", details: "not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 errors")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failing")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
  });

  it("renders the list of changed files", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
  });

  it("renders notes as a bulleted markdown list", () => {
    render(<ExecutionReportView report={{ notes: ["Heads up about X"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Heads up about X")).toBeDefined();
  });

  it("shows that a PR draft was created", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft: Created/)).toBeDefined();
  });

  it("shows that no PR draft was created", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft: Not created/)).toBeDefined();
  });

  it("omits the PR draft line entirely when the field is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });
});
