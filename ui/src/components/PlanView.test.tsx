import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing but the header wrapper when plan is empty", () => {
    const { container } = render(<PlanView plan={{}} />);
    // No version badge, no confidence bar, no sections
    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(container.querySelectorAll(".space-y-2 > div").length).toBe(0);
  });

  it("renders version badge when planVersion is set", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render version badge when planVersion is absent", () => {
    render(<PlanView plan={{ summary: "hi" }} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });

  it("renders confidence bar with done color at high confidence and percentage text", () => {
    render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("renders confidence bar with waiting color in the mid range", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    const bar = container.querySelector(".bg-state-waiting");
    expect(bar).not.toBeNull();
  });

  it("renders confidence bar with blocked color at low confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(screen.getByText("10%")).toBeDefined();
    const bar = container.querySelector(".bg-state-blocked");
    expect(bar).not.toBeNull();
  });

  it("does not render confidence bar when confidence is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it("renders summary markdown when present", () => {
    render(<PlanView plan={{ summary: "This is the plan summary" }} />);
    expect(screen.getByText("This is the plan summary")).toBeDefined();
  });

  it("renders requirements traceability section when present", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2" }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2")).toBeDefined();
  });

  it("does not render requirements traceability section when absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders steps list with numbering, title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up project", description: "Init repo" },
            { id: "s2", title: "Write code", description: "Implement feature" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Set up project")).toBeDefined();
    expect(screen.getByText("Init repo")).toBeDefined();
    expect(screen.getByText("Write code")).toBeDefined();
    expect(screen.getByText("Implement feature")).toBeDefined();
  });

  it("does not render Steps section when steps array is empty", () => {
    render(<PlanView plan={{ steps: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders assumptions as a bullet list", () => {
    render(
      <PlanView
        plan={{ assumptions: ["Assumption one", "Assumption two"] }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumption one")).toBeDefined();
    expect(screen.getByText("Assumption two")).toBeDefined();
  });

  it("does not render Assumptions section when empty", () => {
    render(<PlanView plan={{ assumptions: [] }} />);
    expect(screen.queryByText("Assumptions")).toBeNull();
  });

  it("renders risks as a bullet list", () => {
    render(<PlanView plan={{ risks: ["Risk of downtime"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk of downtime")).toBeDefined();
  });

  it("does not render Risks section when there are zero risks", () => {
    render(<PlanView plan={{ risks: [] }} />);
    expect(screen.queryByText("Risks")).toBeNull();
  });

  it("renders open questions, including the 'blocks execution' badge only for required ones", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            {
              id: "q1",
              question: "What auth provider?",
              requiredForExecution: true,
            },
            {
              id: "q2",
              question: "What color scheme?",
              requiredForExecution: false,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("What auth provider?")).toBeDefined();
    expect(screen.getByText("What color scheme?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not render Open Questions section when there are none", () => {
    render(<PlanView plan={{ openQuestions: [] }} />);
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders a fully populated plan with every section present at once", () => {
    render(
      <PlanView
        plan={{
          planVersion: 2,
          confidence: 0.9,
          summary: "Full plan summary",
          requirementsTraceability: "Traces to REQ-9",
          steps: [{ id: "s1", title: "Step A", description: "Desc A" }],
          assumptions: ["Assume X"],
          risks: ["Risk Y"],
          openQuestions: [
            { id: "q1", question: "Question Z", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("90%")).toBeDefined();
    expect(screen.getByText("Full plan summary")).toBeDefined();
    expect(screen.getByText("Traces to REQ-9")).toBeDefined();
    expect(screen.getByText("Step A")).toBeDefined();
    expect(screen.getByText("Assume X")).toBeDefined();
    expect(screen.getByText("Risk Y")).toBeDefined();
    expect(screen.getByText("Question Z")).toBeDefined();
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
