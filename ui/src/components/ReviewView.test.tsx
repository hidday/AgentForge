import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView.tsx";

describe("ReviewView", () => {
  it("renders nothing extra when the review object is empty", () => {
    render(<ReviewView review={{}} />);
    expect(screen.queryByText(/Verdict/)).toBeNull();
    expect(screen.queryByText(/Findings/)).toBeNull();
  });

  it("renders an Approved verdict badge in the done style", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("bg-state-done-bg");
    expect(badge.className).toContain("text-state-done");
  });

  it("renders a Changes Requested verdict badge for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    const badge = screen.getByText("Changes Requested");
    expect(badge.className).toContain("bg-state-blocked-bg");
    expect(badge.className).toContain("text-state-blocked");
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Looks mostly good." }} />);
    expect(screen.getByText("Looks mostly good.")).toBeDefined();
  });

  it("renders the findings count heading and each finding's title/details", () => {
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
            {
              id: "f2",
              severity: "nit",
              title: "Naming nit",
              details: "Prefer camelCase.",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Findings (2)")).toBeDefined();
    expect(screen.getByText("Missing null check")).toBeDefined();
    expect(screen.getByText("Will throw on empty input.")).toBeDefined();
    expect(screen.getByText("Naming nit")).toBeDefined();
  });

  it.each(["blocker", "important", "suggestion", "nit"])(
    "renders the %s severity badge with its styled class",
    (severity) => {
      render(
        <ReviewView
          review={{
            findings: [
              {
                id: "f1",
                severity,
                title: "Finding",
                details: "Detail text",
              },
            ],
          }}
        />,
      );
      const badge = screen.getByText(severity);
      expect(badge.className).toContain(`text-severity-${severity}`);
    },
  );

  it("falls back to the nit style for an unrecognized severity", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "catastrophic",
              title: "Finding",
              details: "Detail text",
            },
          ],
        }}
      />,
    );
    const badge = screen.getByText("catastrophic");
    expect(badge.className).toContain("text-severity-nit");
  });

  it("renders the file and line hint when present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Finding",
              details: "Detail text",
              file: "src/foo.ts",
              lineHint: 42,
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByText(
        (_, el) => el?.tagName === "SPAN" && el.textContent === "src/foo.ts:42",
      ),
    ).toBeDefined();
  });

  it("renders the affected step id when present, without a file", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Finding",
              details: "Detail text",
              affectedStepId: "step-3",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-3")).toBeDefined();
  });

  it("omits the meta line entirely when neither file nor affectedStepId is present", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "Finding",
              details: "Detail text",
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/Step:/)).toBeNull();
  });
});
