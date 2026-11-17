import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the default version and omits optional sections when the report is minimal", () => {
    render(<ExecutionReportView report={{}} />);

    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });

  it("renders a custom execution version and the summary as markdown", () => {
    render(
      <ExecutionReportView
        report={{ executionVersion: 3, summary: "Implemented the feature." }}
      />,
    );

    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("Implemented the feature.")).toBeDefined();
  });

  it("colors the score bar green and shows the rationale for a high score", () => {
    const { container } = render(
      <ExecutionReportView
        report={{ score: 0.9, scoreRationale: "All checks passed cleanly." }}
      />,
    );

    expect(screen.getByText("Score: 90%")).toBeDefined();
    expect(screen.getByText("All checks passed cleanly.")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("colors the score bar amber for a mid-range score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);

    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("colors the score bar red for a low score", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.1 }} />);

    expect(screen.getByText("Score: 10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders checks with pass, fail, and other statuses with distinct styling", () => {
    const { container } = render(
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
    expect(container.querySelectorAll(".border-state-done\\/30").length).toBe(1);
    expect(container.querySelectorAll(".border-state-blocked\\/30").length).toBe(1);
  });

  it("renders the files changed list with its count", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );

    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("renders notes as a markdown list", () => {
    render(
      <ExecutionReportView report={{ notes: ["Follow-up needed for caching"] }} />,
    );

    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Follow-up needed for caching")).toBeDefined();
  });

  it("shows 'Created' when a PR draft was created", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft: Created/)).toBeDefined();
  });

  it("shows 'Not created' when a PR draft was explicitly not created", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft: Not created/)).toBeDefined();
  });
});
