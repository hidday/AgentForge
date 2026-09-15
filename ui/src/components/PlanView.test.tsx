import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders every optional section when given a full payload", () => {
    const plan = {
      planVersion: 2,
      confidence: 0.85,
      summary: "This is the summary",
      requirementsTraceability: "Traces requirement A to step 1",
      steps: [
        { id: "s1", title: "Step One", description: "Desc one" },
        { id: "s2", title: "Step Two", description: "Desc two" },
      ],
      assumptions: ["Assumption A"],
      risks: ["Risk A"],
      openQuestions: [
        { id: "q1", question: "Question one?", requiredForExecution: true },
        { id: "q2", question: "Question two?", requiredForExecution: false },
      ],
    };
    const { container } = render(<PlanView plan={plan} />);

    // Version badge
    expect(screen.getByText("v2")).toBeDefined();

    // Confidence bar (>= 0.7 -> done color) + percentage text
    expect(screen.getByText("85%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();

    // Summary
    expect(screen.getByText("This is the summary")).toBeDefined();

    // Requirements traceability
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Traces requirement A to step 1")).toBeDefined();

    // Steps
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Step One")).toBeDefined();
    expect(screen.getByText("Desc one")).toBeDefined();
    expect(screen.getByText("Step Two")).toBeDefined();
    expect(screen.getByText("Desc two")).toBeDefined();

    // Assumptions
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumption A")).toBeDefined();

    // Risks
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();

    // Open questions
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Question one?")).toBeDefined();
    expect(screen.getByText("Question two?")).toBeDefined();
    const blocksExecution = screen.getAllByText("blocks execution");
    expect(blocksExecution.length).toBe(1);
  });

  it("renders confidence bar in warning color for the mid threshold (0.4-0.69)", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
    expect(container.querySelector(".bg-state-done")).toBeNull();
    expect(container.querySelector(".bg-state-blocked")).toBeNull();
  });

  it("renders confidence bar in blocked color below 0.4", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
    expect(container.querySelector(".bg-state-done")).toBeNull();
    expect(container.querySelector(".bg-state-waiting")).toBeNull();
  });

  it("omits every optional section for an empty payload", () => {
    render(<PlanView plan={{}} />);

    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(screen.queryByText(/%$/)).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders open questions without the 'blocks execution' badge when not required for execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Optional question?", requiredForExecution: false },
          ],
        }}
      />,
    );

    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Optional question?")).toBeDefined();
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
