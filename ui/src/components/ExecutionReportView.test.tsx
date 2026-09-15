import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("renders every optional section for a full payload", () => {
    const report = {
      executionVersion: 3,
      score: 0.85,
      scoreRationale: "All checks passed cleanly",
      summary: "Execution summary",
      checks: {
        lint: { status: "pass", details: "No lint errors" },
        typecheck: { status: "fail", details: "2 type errors" },
        tests: { status: "skipped", details: "Not run" },
      },
      filesChanged: ["src/a.ts", "src/b.ts"],
      notes: ["Note one"],
      prDraftCreated: true,
    };
    const { container } = render(<ExecutionReportView report={report} />);

    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("Score: 85%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
    expect(screen.getByText("All checks passed cleanly")).toBeDefined();
    expect(screen.getByText("Execution summary")).toBeDefined();

    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("No lint errors")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("2 type errors")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("Not run")).toBeDefined();

    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();

    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Note one")).toBeDefined();

    expect(screen.getByText(/PR Draft: Created/)).toBeDefined();
  });

  it("defaults the version label to v1 when executionVersion is absent", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders the score bar in warning color for the mid threshold and hides rationale when absent", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
    expect(container.querySelector(".bg-state-done")).toBeNull();
    expect(container.querySelector(".bg-state-blocked")).toBeNull();
  });

  it("renders the score bar in blocked color below 0.4", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.2 }} />);
    expect(screen.getByText("Score: 20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("hides the score bar and rationale entirely when score is absent", () => {
    render(
      <ExecutionReportView
        report={{ scoreRationale: "Should not show without a score" }}
      />,
    );
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText("Should not show without a score")).toBeNull();
  });

  it("omits filesChanged, notes and prDraftCreated sections when absent", () => {
    render(<ExecutionReportView report={{ checks: null }} />);
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft/)).toBeNull();
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("renders prDraftCreated as 'Not created' when false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/PR Draft: Not created/)).toBeDefined();
  });
});
