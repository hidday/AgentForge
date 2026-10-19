import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("ExecutionReportView", () => {
  it("renders the execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("defaults the version to 1 when executionVersion is missing", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders the score bar and percentage when score is present", () => {
    render(<ExecutionReportView report={{ score: 0.85 }} />);
    expect(screen.getByText("Score: 85%")).toBeDefined();
  });

  it("does not render the score row when score is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/^Score:/)).toBeNull();
  });

  it("renders score rationale only alongside a score", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.9, scoreRationale: "All checks passed cleanly." }}
      />,
    );
    expect(screen.getByText("All checks passed cleanly.")).toBeDefined();
  });

  it("does not render rationale when score is absent even if scoreRationale is set", () => {
    render(<ExecutionReportView report={{ scoreRationale: "orphaned rationale" }} />);
    expect(screen.queryByText("orphaned rationale")).toBeNull();
  });

  it("renders the summary through Markdown when present", () => {
    render(<ExecutionReportView report={{ summary: "Did the thing." }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe("Did the thing.");
  });

  it("omits the summary block when absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByTestId("markdown-content")).toBeNull();
  });

  it("renders checks grid with pass/fail/other styling and details", () => {
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

  it("omits the checks section when checks is null", () => {
    render(<ExecutionReportView report={{ checks: null }} />);
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders the files changed list with count", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("omits the files changed section when the list is empty", () => {
    render(<ExecutionReportView report={{ filesChanged: [] }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
  });

  it("renders notes through Markdown", () => {
    render(<ExecutionReportView report={{ notes: ["Note one", "Note two"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(markdownEls.map((el) => el.textContent)).toEqual(["Note one", "Note two"]);
  });

  it("omits the notes section when notes is empty", () => {
    render(<ExecutionReportView report={{ notes: [] }} />);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("renders 'Created' when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft: Created/)).toBeDefined();
  });

  it("renders 'Not created' when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft: Not created/)).toBeDefined();
  });

  it("omits the PR draft row when prDraftCreated is undefined", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });

  it("renders a fully populated report without throwing", () => {
    render(
      <ExecutionReportView
        report={{
          executionVersion: 2,
          summary: "Summary text",
          score: 0.5,
          scoreRationale: "Half the checks failed.",
          checks: { lint: { status: "pass", details: "ok" } },
          filesChanged: ["a.ts"],
          notes: ["note"],
          prDraftCreated: true,
        }}
      />,
    );
    expect(screen.getByText("v2")).toBeDefined();
  });
});
