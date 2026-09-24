import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("defaults the version to v1 and renders no optional sections for a minimal report", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft:/)).toBeNull();
  });

  it("shows the given execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders the summary through Markdown", () => {
    render(<ExecutionReportView report={{ summary: "All good." }} />);
    expect(screen.getByTestId("markdown-content").textContent).toBe("All good.");
  });

  it("renders a high score with done styling and no rationale when none is given", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(screen.getByText("Score: 90%")).toBeDefined();
    const bar = container.querySelector(".bg-state-done");
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("style")).toContain("90%");
  });

  it("renders a mid score with waiting styling", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a low score with blocked styling", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(screen.getByText("Score: 20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("shows the score rationale only alongside a score", () => {
    render(
      <ExecutionReportView
        report={{ score: 0.8, scoreRationale: "Tests pass, minor style nits." }}
      />,
    );
    expect(screen.getByText("Tests pass, minor style nits.")).toBeDefined();
  });

  it("does not show a rationale when score is missing even if scoreRationale is set", () => {
    render(<ExecutionReportView report={{ scoreRationale: "orphaned rationale" }} />);
    expect(screen.queryByText("orphaned rationale")).toBeNull();
  });

  it("renders checks with pass/fail/neutral styling", () => {
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
    expect(screen.getByText("not run")).toBeDefined();
  });

  it("renders the list of changed files with a count", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("renders notes through Markdown", () => {
    render(<ExecutionReportView report={{ notes: ["First note", "Second note"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    const notes = screen.getAllByTestId("markdown-content");
    expect(notes.some((n) => n.textContent === "First note")).toBe(true);
    expect(notes.some((n) => n.textContent === "Second note")).toBe(true);
  });

  it("shows PR Draft: Created when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:\s*Created/)).toBeDefined();
  });

  it("shows PR Draft: Not created when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft:\s*Not created/)).toBeDefined();
  });
});
