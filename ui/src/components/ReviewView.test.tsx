import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView";

describe("ReviewView", () => {
  it("renders nothing extra for an empty review object", () => {
    const { container } = render(<ReviewView review={{}} />);
    expect(container.textContent).toBe("");
  });

  it("renders an approved verdict badge", () => {
    render(<ReviewView review={{ overallVerdict: "approved" }} />);
    expect(screen.getByText("Approved")).toBeDefined();
  });

  it("renders a changes-requested verdict badge for any non-approved verdict", () => {
    render(<ReviewView review={{ overallVerdict: "changes_requested" }} />);
    expect(screen.getByText("Changes Requested")).toBeDefined();
  });

  it("renders the summary text", () => {
    render(<ReviewView review={{ summary: "Looks mostly good." }} />);
    expect(screen.getByText("Looks mostly good.")).toBeDefined();
  });

  it("renders findings with severity, file, line hint, and details", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "blocker",
              file: "src/foo.ts",
              lineHint: 42,
              title: "Null deref",
              details: "This will crash.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
    expect(screen.getByText("Null deref")).toBeDefined();
    expect(screen.getByText("src/foo.ts:42")).toBeDefined();
    expect(screen.getByText("This will crash.")).toBeDefined();
  });

  it("renders an affected step id when there is no file", () => {
    render(
      <ReviewView
        review={{
          findings: [
            {
              id: "f1",
              severity: "nit",
              affectedStepId: "step-2",
              title: "Style nit",
              details: "Minor.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Step: step-2")).toBeDefined();
  });

  it("falls back to the nit style for an unrecognized severity", () => {
    const { container } = render(
      <ReviewView
        review={{
          findings: [
            { id: "f1", severity: "unknown-severity", title: "T", details: "D" },
          ],
        }}
      />,
    );
    expect(container.querySelector(".border-severity-nit\\/30")).not.toBeNull();
  });

  it("omits the file/step line when neither is present", () => {
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
