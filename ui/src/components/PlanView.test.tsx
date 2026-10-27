import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("omits the version tag when planVersion is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });

  it("renders a confidence bar with percentage when confidence is set", () => {
    render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("omits the confidence bar when confidence is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "Do the thing." }} />);
    expect(screen.getByText("Do the thing.")).toBeDefined();
  });

  it("renders requirements traceability section when present", () => {
    render(
      <PlanView plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2." }} />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2.")).toBeDefined();
  });

  it("renders numbered steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up scaffolding", description: "Create files." },
            { id: "s2", title: "Wire up API", description: "Connect endpoints." },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Set up scaffolding")).toBeDefined();
    expect(screen.getByText("Wire up API")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
  });

  it("does not render a Steps section when steps is empty", () => {
    render(<PlanView plan={{ steps: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders assumptions as a bulleted list", () => {
    render(<PlanView plan={{ assumptions: ["Node 22 is available."] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Node 22 is available.")).toBeDefined();
  });

  it("renders risks as a bulleted list", () => {
    render(<PlanView plan={{ risks: ["Migration could be slow."] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Migration could be slow.")).toBeDefined();
  });

  it("renders open questions and marks required ones as blocking execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which runtime?", requiredForExecution: true },
            { id: "q2", question: "Any style preference?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which runtime?")).toBeDefined();
    expect(screen.getByText("Any style preference?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not show the 'blocks execution' tag for optional questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Optional question?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.queryByText("blocks execution")).toBeNull();
  });

  it("renders nothing extra for a fully empty plan besides the header row", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.querySelectorAll("h4").length).toBe(0);
  });
});
