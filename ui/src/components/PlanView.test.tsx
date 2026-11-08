import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing version-related and no optional sections for an empty plan", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d+$/)).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 2 }} />);
    expect(screen.getByText("v2")).toBeDefined();
  });

  it("renders a high confidence bar with the done color", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.8 }} />);
    expect(screen.getByText("80%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).toBeTruthy();
  });

  it("renders a mid confidence bar with the waiting color", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).toBeTruthy();
  });

  it("renders a low confidence bar with the blocked color", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).toBeTruthy();
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "Plan summary text" }} />);
    expect(screen.getByText("Plan summary text")).toBeDefined();
  });

  it("renders requirements traceability when present", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Maps to REQ-1 and REQ-2" }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Maps to REQ-1 and REQ-2")).toBeDefined();
  });

  it("renders a numbered list of steps with title and description", () => {
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
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("Do the first thing")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Step two")).toBeDefined();
  });

  it("renders assumptions as a bulleted list", () => {
    render(<PlanView plan={{ assumptions: ["Assume A", "Assume B"] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assume A")).toBeDefined();
    expect(screen.getByText("Assume B")).toBeDefined();
  });

  it("renders risks as a bulleted list", () => {
    render(<PlanView plan={{ risks: ["Risk A"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();
  });

  it("renders open questions, marking those required for execution", () => {
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
    const blocksExecution = screen.getAllByText("blocks execution");
    expect(blocksExecution).toHaveLength(1);
  });

  it("does not render empty-array sections", () => {
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
