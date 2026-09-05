import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra when the review object is empty", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText(/Verdict/)).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders an 'Approved' verdict badge", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Verdict:")).toBeDefined();
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("renders a 'Changes Requested' verdict badge for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    expect(screen.getByText("Changes Requested")).toBeDefined();
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Looks mostly good" }} />);
    expect(screen.getByText("Looks mostly good")).toBeDefined();
  });

  it("renders findings with severity, title, details, file, line hint and step id", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "This will throw",
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
    expect(screen.getByText("This will throw")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
    expect(screen.getByText("Step: step-1")).toBeDefined();
  });

  it("falls back to nit styling for an unrecognized severity and omits file/step block when absent", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f2",
              severity: "totally-unknown",
              title: "Minor thing",
              details: "Nitpick",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("totally-unknown")).toBeDefined();
    // No file/step metadata line should be rendered.
    expect(container.textContent).not.toContain("Step:");
  });

  it("renders a file without a line hint", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f3",
              severity: "nit",
              title: "Style nit",
              details: "Formatting",
              file: "src/bar.ts",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/bar.ts")).toBeDefined();
  });
});
