import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra for a minimal review with no verdict, summary, or findings", () => {
    render(<ReviewView review={{}} />);

    expect(screen.queryByText("Verdict:")).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("shows an 'Approved' badge for an approved verdict", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "approved", summary: "Looks good." }} />,
    );

    expect(screen.getByText("Verdict:")).toBeDefined();
    expect(screen.getByText("Approved")).toBeDefined();
    expect(screen.getByText("Looks good.")).toBeDefined();
    expect(container.querySelector(".bg-state-done-bg")).not.toBeNull();
  });

  it("shows a 'Changes Requested' badge for any non-approved verdict", () => {
    const { container } = render(
      <ReviewView review={{ overallVerdict: "changes_requested" }} />,
    );

    expect(screen.getByText("Changes Requested")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked-bg")).not.toBeNull();
  });

  it("renders findings with severity badge, file/line, step reference, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "Missing null check",
              details: "Crashes when input is undefined.",
              file: "src/foo.ts",
              lineHint: 42,
              affectedStepId: "s1",
            },
            {
              id: "f2",
              severity: "nit",
              title: "Naming",
              details: "Prefer camelCase.",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("Crashes when input is undefined.")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
    expect(screen.getByText("Step: s1")).toBeDefined();
    expect(screen.getByText("nit")).toBeDefined();
    expect(screen.getByText("Naming")).toBeDefined();
  });

  it("falls back to the 'nit' severity style for an unrecognized severity value", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "unknown-severity",
              title: "Edge case",
              details: "Something odd.",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("unknown-severity")).toBeDefined();
    expect(screen.getByText("Edge case")).toBeDefined();
  });

  it("omits the file/step line when neither file nor affectedStepId is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "suggestion", title: "Tidy up", details: "Minor." },
          ],
        }}
      />,
    );

    expect(screen.queryByText(/Step:/)).toBeNull();
  });
});
