import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("ExecutionReportView", () => {
  it("defaults version to v1 when executionVersion is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders the given executionVersion", () => {
    render(<ExecutionReportView report={{ executionVersion: 2 }} />);
    expect(screen.getByText("v2")).toBeDefined();
  });

  it("renders the score bar and percentage when score is present", () => {
    render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(screen.getByText("Score: 90%")).toBeDefined();
  });

  it("does not render score UI when score is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/^Score:/)).toBeNull();
  });

  it("renders score rationale only alongside a score", () => {
    render(<ExecutionReportView report={{ score: 0.5, scoreRationale: "Mostly done" }} />);
    expect(screen.getByText("Mostly done")).toBeDefined();
  });

  it("renders the summary via Markdown", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the feature." }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe(
      "Implemented the feature.",
    );
  });

  it("renders checks with pass/fail/other status styling", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 problems" },
            typecheck: { status: "fail", details: "2 errors" },
            tests: { status: "skipped", details: "not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 problems")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("2 errors")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("not run")).toBeDefined();
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

  it("does not render the files changed section when empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes list via Markdown", () => {
    render(<ExecutionReportView report={{ notes: ["Note one", "Note two"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    const markdowns = screen.getAllByTestId("markdown-content");
    expect(markdowns.some((el) => el.textContent === "Note one")).toBe(true);
    expect(markdowns.some((el) => el.textContent === "Note two")).toBe(true);
  });

  it("shows PR draft created status when true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft: Created/)).toBeDefined();
  });

  it("shows PR draft not-created status when false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft: Not created/)).toBeDefined();
  });

  it("omits the PR draft line entirely when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });
});
