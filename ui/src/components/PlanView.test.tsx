import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders an empty plan without the optional sections", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders the plan version", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders the confidence bar and percentage", () => {
    render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "This plan adds **caching**." }} />);
    expect(screen.getByText("caching").tagName).toBe("STRONG");
  });

  it("renders requirements traceability section when present", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2." }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2.")).toBeDefined();
  });

  it("renders numbered steps with titles and markdown descriptions", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up schema", description: "Add the `users` table." },
            { id: "s2", title: "Write API", description: "Implement the endpoint." },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Set up schema")).toBeDefined();
    expect(screen.getByText("Write API")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("users").tagName).toBe("CODE");
  });

  it("renders assumptions as a bulleted list", () => {
    render(
      <PlanView
        plan={{ assumptions: ["Database is PostgreSQL", "Node >= 22"] }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Database is PostgreSQL")).toBeDefined();
    expect(screen.getByText("Node >= 22")).toBeDefined();
  });

  it("renders risks as a bulleted list", () => {
    render(<PlanView plan={{ risks: ["Migration could lock the table"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Migration could lock the table")).toBeDefined();
  });

  it("renders open questions and marks required ones as blocking execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which region?", requiredForExecution: true },
            { id: "q2", question: "Preferred logging format?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which region?")).toBeDefined();
    expect(screen.getByText("Preferred logging format?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not show 'blocks execution' label for an optional question", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Optional only", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.queryByText("blocks execution")).toBeNull();
  });

  it("applies the blocked color class when confidence is low", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    const bar = container.querySelector(".bg-state-blocked");
    expect(bar).not.toBeNull();
  });

  it("applies the waiting color class when confidence is mid-range", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    const bar = container.querySelector(".bg-state-waiting");
    expect(bar).not.toBeNull();
  });
});
