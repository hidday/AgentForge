import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders an empty plan without crashing and shows no optional sections", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.querySelector(".space-y-5")).not.toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render a version tag when planVersion is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });

  it("renders the confidence bar and percentage", () => {
    render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("colors the confidence bar red below 0.4", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    const bar = container.querySelector(".h-full.rounded-full");
    expect(bar?.className).toContain("bg-state-blocked");
  });

  it("colors the confidence bar amber between 0.4 and 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    const bar = container.querySelector(".h-full.rounded-full");
    expect(bar?.className).toContain("bg-state-waiting");
  });

  it("colors the confidence bar green at or above 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.9 }} />);
    const bar = container.querySelector(".h-full.rounded-full");
    expect(bar?.className).toContain("bg-state-done");
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "**Bold summary**" }} />);
    const strong = screen.getByText("Bold summary");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renders requirements traceability text", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers req-1 and req-2" }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers req-1 and req-2")).toBeDefined();
  });

  it("renders steps with index, title, and description", () => {
    const plan = {
      steps: [
        { id: "s1", title: "Set up project", description: "Init repo" },
        { id: "s2", title: "Write code", description: "Implement feature" },
      ],
    };
    render(<PlanView plan={plan} />);
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Set up project")).toBeDefined();
    expect(screen.getByText("Write code")).toBeDefined();
  });

  it("renders assumptions as a bulleted list", () => {
    render(<PlanView plan={{ assumptions: ["Node 22 is available"] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Node 22 is available")).toBeDefined();
  });

  it("renders risks as a bulleted list", () => {
    render(<PlanView plan={{ risks: ["May break backwards compat"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("May break backwards compat")).toBeDefined();
  });

  it("renders open questions and marks required-for-execution ones", () => {
    const plan = {
      openQuestions: [
        { id: "q1", question: "What auth method?", requiredForExecution: true },
        { id: "q2", question: "Any style prefs?", requiredForExecution: false },
      ],
    };
    render(<PlanView plan={plan} />);
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("What auth method?")).toBeDefined();
    expect(screen.getByText("Any style prefs?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not show the 'blocks execution' tag for optional questions", () => {
    const plan = {
      openQuestions: [
        { id: "q1", question: "Optional Q", requiredForExecution: false },
      ],
    };
    render(<PlanView plan={plan} />);
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
