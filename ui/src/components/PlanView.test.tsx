import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}));

describe("PlanView", () => {
  it("renders the plan version and summary", () => {
    render(<PlanView plan={{ planVersion: 2, summary: "Do the thing" }} />);
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("Do the thing")).toBeDefined();
  });

  it("renders a confidence bar with percentage and done-colored fill when confidence is high", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
    const fill = container.querySelector(".bg-state-done");
    expect(fill).not.toBeNull();
  });

  it("colors the confidence bar as blocked when confidence is low", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("colors the confidence bar as waiting for a middling confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders numbered steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [{ id: "s1", title: "Write migration", description: "Add column" }],
        }}
      />,
    );
    expect(screen.getByText("Write migration")).toBeDefined();
    expect(screen.getByText("Add column")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
  });

  it("renders assumptions and risks lists", () => {
    render(
      <PlanView
        plan={{
          assumptions: ["DB is Postgres"],
          risks: ["Migration may lock the table"],
        }}
      />,
    );
    expect(screen.getByText("DB is Postgres")).toBeDefined();
    expect(screen.getByText("Migration may lock the table")).toBeDefined();
  });

  it("marks a required open question as blocking execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "What region?", requiredForExecution: true },
          ],
        }}
      />,
    );
    expect(screen.getByText("What region?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not mark an optional open question as blocking", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Nice to have?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.queryByText("blocks execution")).toBeNull();
  });

  it("renders requirements traceability when present", () => {
    render(<PlanView plan={{ requirementsTraceability: "Covers AC-1, AC-2" }} />);
    expect(screen.getByText("Covers AC-1, AC-2")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
  });

  it("renders nothing for optional sections when the plan has no data for them", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });
});
