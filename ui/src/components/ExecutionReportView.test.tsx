import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

import { ExecutionReportView } from "./ExecutionReportView.tsx";

describe("ExecutionReportView", () => {
  it("defaults the execution version to 1 when not provided", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("shows the provided execution version", () => {
    render(<ExecutionReportView report={{ executionVersion: 4 }} />);
    expect(screen.getByText("v4")).toBeDefined();
  });

  it("renders nothing extra when only required-ish fields are empty", () => {
    render(<ExecutionReportView report={{}} />);
    expect(screen.queryByText(/Score/)).toBeNull();
    expect(screen.queryByText("Checks")).toBeNull();
    expect(screen.queryByText(/Files Changed/)).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText(/PR Draft/)).toBeNull();
  });

  it("renders a high score in the done color", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.9 }} />);
    expect(screen.getByText("Score: 90%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders a mid score in the waiting color", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.5 }} />);
    expect(screen.getByText("Score: 50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a low score in the blocked color", () => {
    const { container } = render(<ExecutionReportView report={{ score: 0.1 }} />);
    expect(screen.getByText("Score: 10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("shows the score rationale only alongside a score", () => {
    render(
      <ExecutionReportView report={{ score: 0.8, scoreRationale: "Solid coverage" }} />,
    );
    expect(screen.getByText("Solid coverage")).toBeDefined();
  });

  it("hides the score rationale when there is no score", () => {
    render(<ExecutionReportView report={{ scoreRationale: "Solid coverage" }} />);
    expect(screen.queryByText("Solid coverage")).toBeNull();
  });

  it("renders the summary text", () => {
    render(<ExecutionReportView report={{ summary: "Implemented the feature." }} />);
    expect(screen.getByText("Implemented the feature.")).toBeDefined();
  });

  it("renders passing, failing, and neutral checks with matching icon/status styling", () => {
    render(
      <ExecutionReportView
        report={{
          checks: {
            lint: { status: "pass", details: "0 problems" },
            tests: { status: "fail", details: "2 failing" },
            typecheck: { status: "skipped", details: "not run" },
          },
        }}
      />,
    );
    expect(screen.getByText("Checks")).toBeDefined();
    expect(screen.getByText("lint")).toBeDefined();
    expect(screen.getByText("0 problems")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.getByText("2 failing")).toBeDefined();
    expect(screen.getByText("typecheck")).toBeDefined();
    expect(screen.getByText("not run")).toBeDefined();
  });

  it("lists changed files with a count heading", () => {
    render(
      <ExecutionReportView
        report={{ filesChanged: ["src/a.ts", "src/b.ts"] }}
      />,
    );
    expect(screen.getByText("Files Changed (2)")).toBeDefined();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("src/b.ts")).toBeDefined();
  });

  it("renders notes as a bulleted list", () => {
    render(<ExecutionReportView report={{ notes: ["Remember to update docs"] }} />);
    expect(screen.getByText("Notes")).toBeDefined();
    expect(screen.getByText("Remember to update docs")).toBeDefined();
  });

  it("shows PR Draft: Created when prDraftCreated is true", () => {
    render(<ExecutionReportView report={{ prDraftCreated: true }} />);
    expect(screen.getByText(/PR Draft:/)).toBeDefined();
    expect(screen.getByText(/Created/)).toBeDefined();
  });

  it("shows PR Draft: Not created when prDraftCreated is false", () => {
    render(<ExecutionReportView report={{ prDraftCreated: false }} />);
    expect(screen.getByText(/Not created/)).toBeDefined();
  });
});
