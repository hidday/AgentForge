import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

const richPlan: Record<string, unknown> = {
  planVersion: 3,
  confidence: 0.85,
  summary: "This is the plan summary.",
  requirementsTraceability: "Covers REQ-1 and REQ-2.",
  steps: [
    { id: "s1", title: "Step one", description: "Do the first thing." },
    { id: "s2", title: "Step two", description: "Do the second thing." },
  ],
  assumptions: ["Assumption A", "Assumption B"],
  risks: ["Risk A", "Risk B"],
  openQuestions: [
    { id: "q1", question: "Required question?", requiredForExecution: true },
    { id: "q2", question: "Optional question?", requiredForExecution: false },
  ],
};

describe("PlanView", () => {
  it("renders all sections for a rich payload", () => {
    render(<PlanView plan={richPlan} />);

    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("85%")).toBeDefined();
    expect(screen.getByText("This is the plan summary.")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2.")).toBeDefined();

    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("Do the first thing.")).toBeDefined();
    expect(screen.getByText("Step two")).toBeDefined();
    expect(screen.getByText("Do the second thing.")).toBeDefined();
    // Step numbering
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();

    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumption A")).toBeDefined();
    expect(screen.getByText("Assumption B")).toBeDefined();

    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();
    expect(screen.getByText("Risk B")).toBeDefined();

    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Required question?")).toBeDefined();
    expect(screen.getByText("Optional question?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("colors the confidence bar green for high confidence (>= 0.7)", () => {
    render(<PlanView plan={{ confidence: 0.9 }} />);
    const bar = document.querySelector(".bg-state-done");
    expect(bar).not.toBeNull();
    expect((bar as HTMLElement).style.width).toBe("90%");
  });

  it("colors the confidence bar yellow for medium confidence (0.4 - 0.69)", () => {
    render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(document.querySelector(".bg-state-waiting")).not.toBeNull();
    expect(document.querySelector(".bg-state-done")).toBeNull();
  });

  it("colors the confidence bar red for low confidence (< 0.4)", () => {
    render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(document.querySelector(".bg-state-blocked")).not.toBeNull();
    expect(document.querySelector(".bg-state-done")).toBeNull();
    expect(document.querySelector(".bg-state-waiting")).toBeNull();
  });

  it("renders a minimal/empty payload without optional sections", () => {
    const { container } = render(<PlanView plan={{}} />);

    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
    expect(container.querySelector(".bg-border")).toBeNull();
    // Still renders the root container without crashing
    expect(container.firstChild).not.toBeNull();
  });

  it("omits the version label when planVersion is not provided", () => {
    render(<PlanView plan={{ summary: "hi" }} />);
    expect(screen.queryByText(/^v\d+$/)).toBeNull();
  });

  it("does not render the requiredForExecution tag for optional-only open questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Just curious?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Just curious?")).toBeDefined();
    expect(screen.queryByText("blocks execution")).toBeNull();
  });

  it("treats empty arrays as absent sections", () => {
    render(
      <PlanView
        plan={{
          steps: [],
          assumptions: [],
          risks: [],
          openQuestions: [],
        }}
      />,
    );
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });
});
