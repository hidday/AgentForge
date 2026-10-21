import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra when the plan has no optional fields", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.querySelector("h4")).toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render a version badge when planVersion is absent", () => {
    render(<PlanView plan={{ summary: "x" }} />);
    expect(screen.queryByText(/^v\d+$/)).toBeNull();
  });

  it("renders the confidence meter with percentage and done color at high confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.9 }} />);
    expect(screen.getByText("90%")).toBeDefined();
    const bar = container.querySelector(".bg-state-done");
    expect(bar).toBeTruthy();
  });

  it("uses the waiting color for mid-range confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).toBeTruthy();
  });

  it("uses the blocked color for low confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(screen.getByText("10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).toBeTruthy();
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "**Important** summary" }} />);
    expect(screen.getByText("Important").tagName).toBe("STRONG");
  });

  it("renders requirements traceability when present", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2" }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2")).toBeDefined();
  });

  it("renders a numbered list of steps", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Step one", description: "Do the first thing" },
            { id: "s2", title: "Step two", description: "Do the second thing" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("Step two")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
  });

  it("does not render a Steps section when steps is empty", () => {
    render(<PlanView plan={{ steps: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders assumptions as a bulleted list", () => {
    render(<PlanView plan={{ assumptions: ["Assumption A", "Assumption B"] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumption A")).toBeDefined();
    expect(screen.getByText("Assumption B")).toBeDefined();
  });

  it("renders risks as a bulleted list", () => {
    render(<PlanView plan={{ risks: ["Risk A"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();
  });

  it("renders open questions and flags the ones required for execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Required question?", requiredForExecution: true },
            { id: "q2", question: "Optional question?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Required question?")).toBeDefined();
    expect(screen.getByText("Optional question?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not show the blocks-execution tag for non-required questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Optional?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
