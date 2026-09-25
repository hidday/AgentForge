import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for a completely empty plan (no crash, no optional sections)", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(screen.queryByText(/Steps/)).toBeNull();
    expect(screen.queryByText(/Assumptions/)).toBeNull();
    expect(screen.queryByText(/Risks/)).toBeNull();
    expect(screen.queryByText(/Open Questions/)).toBeNull();
    // header row with confidence bar area still renders (empty div), no crash
    expect(container.querySelector(".space-y-5")).not.toBeNull();
  });

  it("renders the plan version when planVersion is provided", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render a version label when planVersion is missing", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "This is the **plan** summary" }} />);
    expect(screen.getByText("plan", { selector: "strong" })).toBeDefined();
  });

  it("renders requirements traceability section when present", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2" }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText(/Covers REQ-1 and REQ-2/)).toBeDefined();
  });

  it("renders confidence bar with done color at high confidence (>= 0.7)", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.9 }} />);
    expect(screen.getByText("90%")).toBeDefined();
    const fill = container.querySelector(".bg-state-done");
    expect(fill).not.toBeNull();
    expect(fill).toHaveProperty("style");
    expect((fill as HTMLElement).style.width).toBe("90%");
  });

  it("renders confidence bar with waiting color at mid confidence (0.4 - 0.69)", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders confidence bar with blocked color at low confidence (< 0.4)", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(screen.getByText("10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("does not render a confidence bar when confidence is missing", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it("renders steps in order with 1-based index and markdown descriptions", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up project", description: "Init the repo" },
            { id: "s2", title: "Write code", description: "Implement **feature**" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Set up project")).toBeDefined();
    expect(screen.getByText("Write code")).toBeDefined();
    expect(screen.getByText("feature", { selector: "strong" })).toBeDefined();
  });

  it("does not render the Steps section when steps is empty", () => {
    render(<PlanView plan={{ steps: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders assumptions list", () => {
    render(
      <PlanView plan={{ assumptions: ["Node 22 is available", "CI is green"] }} />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Node 22 is available")).toBeDefined();
    expect(screen.getByText("CI is green")).toBeDefined();
  });

  it("renders risks list", () => {
    render(<PlanView plan={{ risks: ["Migration could fail"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Migration could fail")).toBeDefined();
  });

  it("renders open questions and marks required ones as blocking execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which env?", requiredForExecution: true },
            { id: "q2", question: "Any style prefs?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which env?")).toBeDefined();
    expect(screen.getByText("Any style prefs?")).toBeDefined();
    expect(screen.getAllByText("blocks execution").length).toBe(1);
  });

  it("does not render Open Questions section when there are none", () => {
    render(<PlanView plan={{ openQuestions: [] }} />);
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders a fully populated plan end to end", () => {
    render(
      <PlanView
        plan={{
          planVersion: 2,
          confidence: 0.8,
          summary: "Summary text",
          requirementsTraceability: "Traces requirement A",
          steps: [{ id: "s1", title: "Step one", description: "Do it" }],
          assumptions: ["Assumption one"],
          risks: ["Risk one"],
          openQuestions: [
            { id: "q1", question: "Question one", requiredForExecution: true },
          ],
        }}
      />,
    );
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("80%")).toBeDefined();
    expect(screen.getByText("Summary text")).toBeDefined();
    expect(screen.getByText("Traces requirement A")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("Assumption one")).toBeDefined();
    expect(screen.getByText("Risk one")).toBeDefined();
    expect(screen.getByText("Question one")).toBeDefined();
  });
});
