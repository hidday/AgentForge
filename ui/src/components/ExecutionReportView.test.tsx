import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the execution version, defaulting to 1 when absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders an explicit execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 2 }} />);
    expect(screen.getByText("v2")).toBeDefined();
  });

  it("renders a passing score with done styling and no rationale by default", () => {
    render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(screen.getByText("Score: 90%")).toBeDefined();
  });

  it("renders a failing score with blocked styling", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(screen.getByText("Score: 20%")).toBeDefined();
    const bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain("state-blocked");
  });

  it("renders a mid score with waiting styling", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    const bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain("state-waiting");
  });

  it("renders the score rationale only when a score is also present", () => {
    render(<ExecutionReportView report={{ scoreRationale: "orphan rationale" }} />);
    expect(screen.queryByText("orphan rationale")).toBeNull();

    render(<ExecutionReportView report={{ score: 0.8, scoreRationale: "solid coverage" }} />);
    expect(screen.getByText("solid coverage")).toBeDefined();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the feature." }} />);
    expect(screen.getByText("Implemented the feature.")).toBeDefined();
  });

  it("renders a passing check with its details", () => {
    render(
      <ExecutionReportView
        report={{ checks: { lint: { status: "pass", details: "0 errors" } } }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 errors")).toBeDefined();
  });

  it("renders a failing check and an unknown-status check distinctly", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            tests: { status: "fail", details: "2 failed" },
            typecheck: { status: "skipped", details: "n/a" },
          },
        }}
      />,
    );
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failed")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
  });

  it("renders the list of changed files with a count", () => {
    render(
      <ExecutionReportView report={{ filesChanged: ["src/a.ts", "src/b.ts"] }} />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("renders notes as a list", () => {
    render(<ExecutionReportView report={{ notes: ["Follow-up needed for X"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Follow-up needed for X")).toBeDefined();
  });

  it("renders 'Created' when a PR draft was created", () => {
    const { container } = render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(container.textContent).toContain("PR Draft: Created");
  });

  it("renders 'Not created' when prDraftCreated is explicitly false", () => {
    const { container } = render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(container.textContent).toContain("PR Draft: Not created");
  });

  it("omits the PR draft line entirely when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });
});
