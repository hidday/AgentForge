import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView";

describe("PlanView", () => {
  it("renders nothing extra for an empty plan object", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.textContent).toBe("");
  });

  it("renders the plan version and confidence bar", () => {
    render(<PlanView plan={{ planVersion: 3, confidence: 0.85 }} />);
    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("uses a waiting color for medium confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("uses a blocked color for low confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary and requirements traceability as markdown", () => {
    render(
      <PlanView
        plan={{ summary: "Do the thing", requirementsTraceability: "Covers REQ-1" }}
      />,
    );
    expect(screen.getByText("Do the thing")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1")).toBeDefined();
  });

  it("renders numbered steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Step one", description: "Do step one" },
            { id: "s2", title: "Step two", description: "Do step two" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
  });

  it("renders assumptions and risks as bulleted lists", () => {
    render(
      <PlanView
        plan={{
          assumptions: ["Assumption A"],
          risks: ["Risk A"],
        }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumption A")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();
  });

  it("renders open questions and flags ones required for execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "What about X?", requiredForExecution: true },
            { id: "q2", question: "What about Y?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("What about X?")).toBeDefined();
    expect(screen.getAllByText("blocks execution")).toHaveLength(1);
  });
});
