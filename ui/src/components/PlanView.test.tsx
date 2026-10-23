import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders only the (empty) header for a plan with no optional fields, without crashing", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    // Still renders the outer wrapper
    expect(container.querySelector(".space-y-5")).not.toBeNull();
  });

  it("renders plan version and summary", () => {
    render(
      <PlanView
        plan={{ planVersion: 3, summary: "Plan summary text" }}
      />,
    );
    expect(screen.getByText("v3")).toBeDefined();
    expect(screen.getByText("Plan summary text")).toBeDefined();
  });

  it("renders the confidence bar with the rounded percentage", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.82 }} />);
    expect(screen.getByText("82%")).toBeDefined();
    const bar = container.querySelector('[style*="width"]') as HTMLElement;
    expect(bar.style.width).toBe("82%");
  });

  it("uses the blocked color for low confidence and done color for high confidence", () => {
    const low = render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(low.container.querySelector(".bg-state-blocked")).not.toBeNull();
    low.unmount();

    const high = render(<PlanView plan={{ confidence: 0.9 }} />);
    expect(high.container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders steps with 1-based numbering, title and description", () => {
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
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("Step two")).toBeDefined();
  });

  it("renders assumptions and risks lists", () => {
    render(
      <PlanView
        plan={{
          assumptions: ["Assumption A"],
          risks: ["Risk A"],
        }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumption A")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();
  });

  it("renders open questions and marks required ones as blocking execution", () => {
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
    expect(screen.getByText("Required question?")).toBeDefined();
    expect(screen.getByText("Optional question?")).toBeDefined();
    const blockingLabels = screen.getAllByText("blocks execution");
    expect(blockingLabels.length).toBe(1);
  });

  it("renders requirements traceability section when present", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Maps to REQ-1, REQ-2" }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Maps to REQ-1, REQ-2")).toBeDefined();
  });
});
