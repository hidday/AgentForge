import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for a completely empty plan (no optional sections)", () => {
    const { container } = render(<PlanView plan={{}} />);
    // header row present but empty
    expect(screen.queryByText(/^v/)).toBeNull();
    expect(container.querySelector(".h-1\\.5")).toBeNull(); // no confidence bar
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders the plan version when provided", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders confidence bar with done color and percentage when >= 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
    const bar = container.querySelector(".bg-state-done");
    expect(bar).not.toBeNull();
    expect((bar as HTMLElement).style.width).toBe("85%");
  });

  it("renders confidence bar with waiting color when between 0.4 and 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders confidence bar with blocked color when < 0.4", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders summary as markdown", () => {
    render(<PlanView plan={{ summary: "**Important** summary" }} />);
    expect(screen.getByText("Important")).toBeDefined();
    expect(screen.getByText("Important").tagName).toBe("STRONG");
  });

  it("renders requirements traceability section with heading and markdown content", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2" }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText(/Covers REQ-1 and REQ-2/)).toBeDefined();
  });

  it("renders steps with index, title, and markdown description", () => {
    const plan = {
      steps: [
        { id: "s1", title: "Step One", description: "Do the *first* thing" },
        { id: "s2", title: "Step Two", description: "Do the second thing" },
      ],
    };
    render(<PlanView plan={plan} />);
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Step One")).toBeDefined();
    expect(screen.getByText("Step Two")).toBeDefined();
    // markdown emphasis rendered
    const em = screen.getByText("first");
    expect(em.tagName).toBe("EM");
  });

  it("does not render Steps section when steps array is empty", () => {
    render(<PlanView plan={{ steps: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders assumptions list items via markdown", () => {
    render(
      <PlanView
        plan={{ assumptions: ["Assumption A", "Assumption B"] }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumption A")).toBeDefined();
    expect(screen.getByText("Assumption B")).toBeDefined();
  });

  it("renders risks list items via markdown", () => {
    render(<PlanView plan={{ risks: ["Risk A", "Risk B"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();
    expect(screen.getByText("Risk B")).toBeDefined();
  });

  it("renders open questions, marking those required for execution", () => {
    const plan = {
      openQuestions: [
        { id: "q1", question: "Is this safe?", requiredForExecution: true },
        { id: "q2", question: "Any preference?", requiredForExecution: false },
      ],
    };
    render(<PlanView plan={plan} />);
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Is this safe?")).toBeDefined();
    expect(screen.getByText("Any preference?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
    // only one "blocks execution" badge, for q1
    expect(screen.getAllByText("blocks execution").length).toBe(1);
  });

  it("does not render 'blocks execution' badge when requiredForExecution is false", () => {
    const plan = {
      openQuestions: [
        { id: "q1", question: "Optional question", requiredForExecution: false },
      ],
    };
    render(<PlanView plan={plan} />);
    expect(screen.getByText("Optional question")).toBeDefined();
    expect(screen.queryByText("blocks execution")).toBeNull();
  });

  it("renders a fully populated plan with all sections together", () => {
    const plan = {
      planVersion: 2,
      confidence: 0.9,
      summary: "Overall summary",
      requirementsTraceability: "Traces to REQ-9",
      steps: [{ id: "s1", title: "Only step", description: "desc" }],
      assumptions: ["assume one"],
      risks: ["risk one"],
      openQuestions: [
        { id: "q1", question: "question one", requiredForExecution: true },
      ],
    };
    render(<PlanView plan={plan} />);
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("90%")).toBeDefined();
    expect(screen.getByText("Overall summary")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Only step")).toBeDefined();
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Open Questions")).toBeDefined();
  });
});
