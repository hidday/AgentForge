import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

// Render Markdown content as plain text so assertions can target it simply,
// while still verifying PlanView passes the right strings through.
vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

const fullPlan = {
  planVersion: 2,
  confidence: 0.85,
  summary: "Implement the feature end to end.",
  requirementsTraceability: "Covers REQ-1 and REQ-2.",
  steps: [
    { id: "s1", title: "Set up schema", description: "Add the new table." },
    { id: "s2", title: "Wire up API", description: "Expose the endpoint." },
  ],
  assumptions: ["The database is already migrated."],
  risks: ["Backward compatibility might break."],
  openQuestions: [
    { id: "q1", question: "Should this be feature-flagged?", requiredForExecution: true },
    { id: "q2", question: "Any naming preference?", requiredForExecution: false },
  ],
};

describe("PlanView", () => {
  it("renders all sections of a full plan", () => {
    render(<PlanView plan={fullPlan} />);

    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("85%")).toBeDefined();
    expect(screen.getByText("Implement the feature end to end.")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2.")).toBeDefined();

    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Set up schema")).toBeDefined();
    expect(screen.getByText("Add the new table.")).toBeDefined();
    expect(screen.getByText("Wire up API")).toBeDefined();
    // Step index prefix is rendered
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();

    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("The database is already migrated.")).toBeDefined();

    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Backward compatibility might break.")).toBeDefined();

    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Should this be feature-flagged?")).toBeDefined();
    expect(screen.getByText("Any naming preference?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("applies the done confidence color at high confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.9 }} />);
    const bar = container.querySelector(".bg-state-done");
    expect(bar).not.toBeNull();
  });

  it("applies the waiting confidence color at mid confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    const bar = container.querySelector(".bg-state-waiting");
    expect(bar).not.toBeNull();
  });

  it("applies the blocked confidence color at low confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    const bar = container.querySelector(".bg-state-blocked");
    expect(bar).not.toBeNull();
  });

  it("does not render optional sections or badges when fields are missing", () => {
    const { container } = render(<PlanView plan={{}} />);

    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(container.querySelector(".bg-border")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("does not render list sections when their arrays are empty", () => {
    render(
      <PlanView
        plan={{
          steps: [],
          assumptions: [],
          risks: [],
          openQuestions: [],
        }}
      />,
    );

    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("does not show the 'blocks execution' tag for optional questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Optional only", requiredForExecution: false },
          ],
        }}
      />,
    );

    expect(screen.getByText("Optional only")).toBeDefined();
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
