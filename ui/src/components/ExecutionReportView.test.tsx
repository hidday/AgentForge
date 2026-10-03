import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the default version when none is given and no optional sections", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });

  it("renders the execution version and score bar with rationale", () => {
    const { container } = render(
      <ExecutionReportView
        report={{
          executionVersion: 2,
          score: 0.9,
          scoreRationale: "All checks passed cleanly.",
        }}
      />,
    );
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Score: 90%")).toBeDefined();
    expect(screen.getByText("All checks passed cleanly.")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("uses the waiting and blocked colors for mid and low scores", () => {
    const { container: mid } = render(
      <ExecutionReportView report={{ score: 0.5 }} />,
    );
    expect(mid.querySelector(".bg-state-waiting")).not.toBeNull();

    const { container: low } = render(
      <ExecutionReportView report={{ score: 0.1 }} />,
    );
    expect(low.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "Did the thing." }} />);
    expect(screen.getByText("Did the thing.")).toBeDefined();
  });

  it("renders checks with pass/fail/other styling", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "No issues." },
            tests: { status: "fail", details: "2 failing." },
            typecheck: { status: "skipped", details: "Not run." },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("No issues.")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failing.")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("Not run.")).toBeDefined();
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

  it("renders notes as a bulleted markdown list", () => {
    render(
      <ExecutionReportView
        report={{ notes: ["Note one.", "Note two."] }}
      />,
    );
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Note one.")).toBeDefined();
    expect(screen.getByText("Note two.")).toBeDefined();
  });

  it("renders the PR draft created/not-created status", () => {
    const { rerender } = render(
      <ExecutionReportView report={{ prDraftCreated: true }} />,
    );
    expect(screen.getByText("PR Draft: Created")).toBeDefined();

    rerender(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText("PR Draft: Not created")).toBeDefined();
  });
});
