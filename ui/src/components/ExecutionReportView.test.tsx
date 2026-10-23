import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}));

import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("defaults to v1 and renders no optional sections when report is empty", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });

  it("renders the execution version and summary", () => {
    render(
      <ExecutionReportView
        report={{ executionVersion: 2, summary: "Implemented the feature" }}
      />,
    );
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Implemented the feature")).toBeDefined();
  });

  it("renders the score bar with rationale when score is provided", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.75, scoreRationale: "Tests pass, minor gaps" }}
      />,
    );
    expect(screen.getByText("Score: 75%")).toBeDefined();
    expect(screen.getByText("Tests pass, minor gaps")).toBeDefined();
  });

  it("does not render rationale text when score is absent even if scoreRationale is set", () => {
    render(<ExecutionReportView report={{ scoreRationale: "orphan rationale" }} />);
    expect(screen.queryByText("orphan rationale")).toBeNull();
  });

  it("renders a checks grid with pass/fail/other statuses", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 errors" },
            tests: { status: "fail", details: "2 failing" },
            typecheck: { status: "skipped", details: "n/a" },
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

  it("renders notes as a list", () => {
    render(<ExecutionReportView report={{ notes: ["Note one", "Note two"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Note one")).toBeDefined();
    expect(screen.getByText("Note two")).toBeDefined();
  });

  it("renders PR draft status text for both true and false values", () => {
    const created = render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(created.getByText(/PR Draft:\s*Created/)).toBeDefined();
    created.unmount();

    const notCreated = render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(notCreated.getByText(/PR Draft:\s*Not created/)).toBeDefined();
  });
});
