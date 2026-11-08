import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders the default version when none is given and omits optional sections", () => {
    const { container } = render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft/)).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders the given execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders a high score with the done color and formatted percentage", () => {
    const { container } = render(
      <ExecutionReportView report={{ score: 0.87 }} />,
    );
    expect(screen.getByText("Score: 87%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).toBeTruthy();
  });

  it("renders a mid score with the waiting color", () => {
    const { container } = render(
      <ExecutionReportView report={{ score: 0.5 }} />,
    );
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).toBeTruthy();
  });

  it("renders a low score with the blocked color", () => {
    const { container } = render(
      <ExecutionReportView report={{ score: 0.1 }} />,
    );
    expect(screen.getByText("Score: 10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).toBeTruthy();
  });

  it("renders score rationale only alongside a score", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.9, scoreRationale: "All checks passed cleanly" }}
      />,
    );
    expect(screen.getByText("All checks passed cleanly")).toBeDefined();
  });

  it("does not render score rationale when there is no score", () => {
    render(
      <ExecutionReportView report={{ scoreRationale: "orphan rationale" }} />,
    );
    expect(screen.queryByText("orphan rationale")).toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<ExecutionReportView report={{ summary: "Did the thing" }} />);
    expect(screen.getByText("Did the thing")).toBeDefined();
  });

  it("renders checks with pass, fail and unknown statuses", () => {
    const { container } = render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "no issues" },
            tests: { status: "fail", details: "2 failing" },
            typecheck: { status: "pending", details: "running" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("no issues")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failing")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("running")).toBeDefined();
    expect(container.querySelector(".border-state-done\\/30")).toBeTruthy();
    expect(container.querySelector(".border-state-blocked\\/30")).toBeTruthy();
    expect(container.querySelector(".border-border-subtle")).toBeTruthy();
  });

  it("does not render the checks section when checks is null", () => {
    render(<ExecutionReportView report={{ checks: null }} />);
    expect(screen.queryByText("Checks")).toBeNull();
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

  it("does not render the files changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes as a bulleted markdown list", () => {
    render(
      <ExecutionReportView report={{ notes: ["First note", "Second note"] }} />,
    );
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("First note")).toBeDefined();
    expect(screen.getByText("Second note")).toBeDefined();
  });

  it("renders 'Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(
      screen.getByText((_, el) => el?.textContent === "PR Draft: Created"),
    ).toBeDefined();
  });

  it("renders 'Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(
      screen.getByText((_, el) => el?.textContent === "PR Draft: Not created"),
    ).toBeDefined();
  });

  it("does not render the PR draft line when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });
});
