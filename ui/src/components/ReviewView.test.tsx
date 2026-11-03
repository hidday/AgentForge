import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra when review is empty", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.textContent).toBe("");
  });

  it("renders an approved verdict with the done styling", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("state-done");
  });

  it("renders a changes-requested verdict for any non-approved value", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("state-blocked");
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Looks mostly good." }} />);
    expect(screen.getByText("Looks mostly good.")).toBeDefined();
  });

  it("renders findings with severity badge, title, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "Will throw on empty input.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("Will throw on empty input.")).toBeDefined();
  });

  it("falls back to the nit style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "weird-severity", title: "T", details: "D" },
          ],
        }}
      />,
    );
    const badge = screen.getByText("weird-severity");
    expect(badge.className).toContain("severity-nit");
  });

  it("shows file and line hint when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "T",
              details: "D",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
  });

  it("shows file without line hint when lineHint is absent", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "nit", title: "T", details: "D", file: "src/foo.ts" },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts")).toBeDefined();
  });

  it("shows affectedStepId when present instead of file", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "T",
              details: "D",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("does not render the file/step row when neither is present", () => {
    render(
      <ReviewView
        review={{
          findings: [{ id: "f1", severity: "nit", title: "T", details: "D" }],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/)).toBeNull();
  });
});
