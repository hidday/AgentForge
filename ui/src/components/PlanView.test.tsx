import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for a minimal empty plan", () => {
    const { container } = render(<PlanView plan={{}} />);
    // No steps/assumptions/risks/questions sections should render.
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders the confidence bar and percentage", () => {
    render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "This is the plan summary." }} />);
    expect(screen.getByText("This is the plan summary.")).toBeDefined();
  });

  it("renders requirements traceability section when present", () => {
    render(<PlanView plan={{ requirementsTraceability: "Covers REQ-1, REQ-2" }} />);
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1, REQ-2")).toBeDefined();
  });

  it("renders steps with index numbers, titles, and descriptions", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "First step", description: "Do the first thing" },
            { id: "s2", title: "Second step", description: "Do the second thing" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("First step")).toBeDefined();
    expect(screen.getByText("Second step")).toBeDefined();
    expect(screen.getByText("Do the first thing")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
  });

  it("renders assumptions as a bulleted list", () => {
    render(<PlanView plan={{ assumptions: ["Assumes prod DB access"] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumes prod DB access")).toBeDefined();
  });

  it("renders risks as a bulleted list", () => {
    render(<PlanView plan={{ risks: ["Might break the cache"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Might break the cache")).toBeDefined();
  });

  it("renders open questions and marks required ones with 'blocks execution'", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "What DB should we use?", requiredForExecution: true },
            { id: "q2", question: "Any style preference?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("What DB should we use?")).toBeDefined();
    expect(screen.getByText("Any style preference?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not render 'blocks execution' badge for optional questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Optional Q?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
