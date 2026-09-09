import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra when the payload has no fields", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.textContent).toBe("");
  });

  it("shows an 'Approved' badge for an approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("shows a 'Changes Requested' badge for a non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    expect(screen.getByText("Changes Requested")).toBeDefined();
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Looks mostly good." }} />);
    expect(screen.getByText("Looks mostly good.")).toBeDefined();
  });

  it("renders findings with severity, title, file/line, step id and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              file: "src/foo.ts",
              lineHint: 42,
              affectedStepId: "step-2",
              details: "Could throw at runtime.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
    expect(screen.getByText("Step: step-2")).toBeDefined();
    expect(screen.getByText("Could throw at runtime.")).toBeDefined();
  });

  it("omits the line hint when lineHint is not provided", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              title: "Style nit",
              file: "src/foo.ts",
              details: "minor",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("src/foo.ts")).toBeDefined();
  });

  it("falls back to the 'nit' style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "unknown-severity", title: "Odd", details: "d" },
          ],
        }}
      />,
    );
    const badge = screen.getByText("unknown-severity");
    expect(badge.className).toContain("severity-nit");
  });

  it("does not render the file/step line when neither file nor affectedStepId are present", () => {
    render(
      <ReviewView
        review={{
          findings: [{ id: "f1", severity: "important", title: "T", details: "D" }],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/)).toBeNull();
  });
});
