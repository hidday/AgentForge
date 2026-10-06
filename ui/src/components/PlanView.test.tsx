import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders an empty container with no sections when plan has no recognized fields", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.querySelector(".space-y-5")).not.toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders the confidence bar and percentage, colored green for high confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
    const bar = container.querySelector(".bg-state-done");
    expect(bar).not.toBeNull();
  });

  it("colors the confidence bar yellow/waiting for mid confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("colors the confidence bar red/blocked for low confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(screen.getByText("10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "## Overview\nThis is the plan." }} />);
    expect(screen.getByRole("heading", { level: 2 })).toBeDefined();
    expect(screen.getByText("This is the plan.")).toBeDefined();
  });

  it("renders requirements traceability content", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2." }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2.")).toBeDefined();
  });

  it("renders steps with index numbers, titles, and descriptions", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up DB", description: "Create schema" },
            { id: "s2", title: "Write API", description: "Implement routes" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Set up DB")).toBeDefined();
    expect(screen.getByText("Write API")).toBeDefined();
    expect(screen.getByText("Create schema")).toBeDefined();
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

  it("renders open questions and marks required ones as blocking execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which region?", requiredForExecution: true },
            { id: "q2", question: "Any budget cap?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which region?")).toBeDefined();
    expect(screen.getByText("Any budget cap?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not render the 'blocks execution' tag for non-required open questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Optional question?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.queryByText("blocks execution")).toBeNull();
  });

  it("renders no confidence bar when confidence is undefined", () => {
    const { container } = render(<PlanView plan={{ summary: "x" }} />);
    expect(container.querySelector(".bg-state-done, .bg-state-waiting, .bg-state-blocked")).toBeNull();
  });

  it("does not render empty arrays' sections (boundary: empty steps/assumptions/risks/openQuestions)", () => {
    render(
      <PlanView
        plan={{ steps: [], assumptions: [], risks: [], openQuestions: [] }}
      />,
    );
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });
});
