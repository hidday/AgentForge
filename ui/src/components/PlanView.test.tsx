import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for an empty plan object", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders a high (green) confidence bar and percentage", () => {
    render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("renders a medium (yellow) confidence bar", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a low (red) confidence bar", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary via Markdown", () => {
    render(<PlanView plan={{ summary: "This plan does X." }} />);
    expect(screen.getByText("This plan does X.")).toBeDefined();
  });

  it("renders requirements traceability with its heading", () => {
    render(<PlanView plan={{ requirementsTraceability: "Covers REQ-1, REQ-2." }} />);
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1, REQ-2.")).toBeDefined();
  });

  it("renders numbered steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Step One", description: "Do the first thing." },
            { id: "s2", title: "Step Two", description: "Do the second thing." },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Step One")).toBeDefined();
    expect(screen.getByText("Do the first thing.")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
  });

  it("renders assumptions as a list", () => {
    render(<PlanView plan={{ assumptions: ["Assumes CI is green.", "Assumes staging exists."] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumes CI is green.")).toBeDefined();
  });

  it("renders risks as a list", () => {
    render(<PlanView plan={{ risks: ["Migration could fail."] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Migration could fail.")).toBeDefined();
  });

  it("renders open questions, marking ones required for execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which DB do we use?", requiredForExecution: true },
            { id: "q2", question: "Optional styling question?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which DB do we use?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
    expect(screen.getByText("Optional styling question?")).toBeDefined();
  });

  it("does not render the 'blocks execution' tag for a non-required question", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Just curious?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
