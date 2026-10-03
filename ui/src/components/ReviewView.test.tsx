import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra for an empty review object", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText(/Verdict/)).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders an Approved badge for an approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("renders a Changes Requested badge for a non-approved verdict", () => {
    render(
      <ReviewView review={{ overallVerdict: "changes_requested" }} />,
    );
    expect(screen.getByText("Changes Requested")).toBeDefined();
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Overall looks solid." }} />);
    expect(screen.getByText("Overall looks solid.")).toBeDefined();
  });

  it("renders findings with severity badge, title, details, file, and step", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "Will throw on empty input.",
              file: "src/foo.ts",
              lineHint: 42,
              affectedStepId: "step-1",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("Will throw on empty input.")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
    expect(screen.getByText("Step: step-1")).toBeDefined();
  });

  it("falls back to the nit style for an unrecognized severity and omits file/step line when absent", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f2",
              severity: "unknown-severity",
              title: "Style nit",
              details: "Prefer const over let.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("unknown-severity")).toBeDefined();
    expect(screen.queryByText(/Step:/)).toBeNull();
    // No file/step metadata line should be rendered at all.
    const metaLine = container.querySelector(".font-mono.text-text-muted");
    expect(metaLine).toBeNull();
  });
});
