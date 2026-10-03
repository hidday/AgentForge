import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for an empty plan object (no crash, no sections)", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders the plan version and confidence bar", () => {
    const { container } = render(
      <PlanView plan={{ planVersion: 3, confidence: 0.85 }} />,
    );
    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("85%")).toBeDefined();
    const bar = container.querySelector(".bg-state-done");
    expect(bar).not.toBeNull();
  });

  it("uses the waiting color for mid-range confidence and blocked color for low confidence", () => {
    const { container: mid } = render(
      <PlanView plan={{ confidence: 0.5 }} />,
    );
    expect(mid.querySelector(".bg-state-waiting")).not.toBeNull();

    const { container: low } = render(
      <PlanView plan={{ confidence: 0.1 }} />,
    );
    expect(low.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary as markdown content", () => {
    render(<PlanView plan={{ summary: "This is the **summary**." }} />);
    expect(screen.getByText(/This is the/)).toBeDefined();
  });

  it("renders requirements traceability section when present", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2." }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText(/Covers REQ-1/)).toBeDefined();
  });

  it("renders numbered steps with titles and descriptions", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up DB", description: "Create schema." },
            { id: "s2", title: "Write API", description: "Add endpoints." },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Set up DB")).toBeDefined();
    expect(screen.getByText("Write API")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
  });

  it("renders assumptions and risks lists", () => {
    render(
      <PlanView
        plan={{
          assumptions: ["Users are authenticated."],
          risks: ["Migration could fail."],
        }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText(/Users are authenticated/)).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText(/Migration could fail/)).toBeDefined();
  });

  it("renders open questions, marking ones required for execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            {
              id: "q1",
              question: "Which env do we deploy to?",
              requiredForExecution: true,
            },
            {
              id: "q2",
              question: "Should we rename the field?",
              requiredForExecution: false,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText(/Which env do we deploy to/)).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
    expect(screen.getByText(/Should we rename the field/)).toBeDefined();
  });
});
