import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra for an empty review", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText("Verdict:")).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("shows an Approved badge with the done styling for an approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
    expect(badge.className).toContain("text-state-done");
  });

  it("shows a Changes Requested badge with the blocked styling for any other verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
    expect(badge.className).toContain("text-state-blocked");
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Looks solid overall." }} />);
    expect(screen.getByText("Looks solid overall.")).toBeDefined();
  });

  it("renders the findings count and each finding's title/details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "Will throw on empty input",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("Will throw on empty input")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
  });

  it("applies the matching severity style class for each known severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "blocker", title: "t1", details: "d1" },
            { id: "f2", severity: "important", title: "t2", details: "d2" },
            { id: "f3", severity: "suggestion", title: "t3", details: "d3" },
            { id: "f4", severity: "nit", title: "t4", details: "d4" },
          ],
        }}
      />,
    );
    expect(screen.getByText("blocker").className).toContain("text-severity-blocker");
    expect(screen.getByText("important").className).toContain("text-severity-important");
    expect(screen.getByText("suggestion").className).toContain("text-severity-suggestion");
    expect(screen.getByText("nit").className).toContain("text-severity-nit");
  });

  it("falls back to the nit style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [{ id: "f1", severity: "mystery", title: "t1", details: "d1" }],
        }}
      />,
    );
    expect(screen.getByText("mystery").className).toContain("text-severity-nit");
  });

  it("shows the file and line hint when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "t1",
              details: "d1",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("shows the affected step id when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "t1",
              details: "d1",
              affectedStepId: "step-2",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-2")).toBeDefined();
  });

  it("omits the file/step meta row entirely when neither is present", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [{ id: "f1", severity: "nit", title: "t1", details: "d1" }],
        }}
      />,
    );
    expect(container.querySelector(".font-mono")).toBeNull();
  });
});
