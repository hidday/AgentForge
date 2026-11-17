import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for a minimal plan with no optional fields", () => {
    render(<PlanView plan={{}} />);

    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders the version and a high confidence bar in the 'done' color range", () => {
    const { container } = render(
      <PlanView plan={{ planVersion: 4, confidence: 0.85 }} />,
    );

    expect(screen.getByText("v4")).toBeDefined();
    expect(screen.getByText("85%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders a mid confidence bar in the 'waiting' color range", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a low confidence bar in the 'blocked' color range", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary and requirements traceability as markdown", () => {
    render(
      <PlanView
        plan={{
          summary: "Add a caching layer.",
          requirementsTraceability: "Covers REQ-1 and REQ-2.",
        }}
      />,
    );

    expect(screen.getByText("Add a caching layer.")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2.")).toBeDefined();
  });

  it("renders a numbered list of steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Write schema", description: "Define the tables." },
            { id: "s2", title: "Write API", description: "Expose endpoints." },
          ],
        }}
      />,
    );

    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Write schema")).toBeDefined();
    expect(screen.getByText("Define the tables.")).toBeDefined();
    expect(screen.getByText("Write API")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
  });

  it("renders assumptions and risks as bullet lists", () => {
    render(
      <PlanView
        plan={{
          assumptions: ["Postgres is already provisioned."],
          risks: ["Migration could lock the table."],
        }}
      />,
    );

    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Postgres is already provisioned.")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Migration could lock the table.")).toBeDefined();
  });

  it("renders open questions and flags the ones required for execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which region?", requiredForExecution: true },
            { id: "q2", question: "Any deadline?", requiredForExecution: false },
          ],
        }}
      />,
    );

    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which region?")).toBeDefined();
    expect(screen.getByText("Any deadline?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });
});
