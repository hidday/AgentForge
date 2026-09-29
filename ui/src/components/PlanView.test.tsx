import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

// Mock the Markdown component so PlanView tests are isolated from react-markdown internals
vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("PlanView", () => {
  it("renders nothing extra for a minimal/empty plan", () => {
    const { container } = render(<PlanView plan={{}} />);
    // Header row still renders (empty version/confidence slots) but no sections
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(container.querySelector(".space-y-5")).not.toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render a version badge when planVersion is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });

  it("renders the confidence bar and percentage with done color when >= 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders the confidence bar with waiting color when between 0.4 and 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders the confidence bar with blocked color when below 0.4", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("does not render the confidence bar when confidence is absent", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.querySelector(".tabular-nums")).toBeNull();
  });

  it("renders the summary through Markdown when present", () => {
    render(<PlanView plan={{ summary: "This is the plan summary." }} />);
    expect(screen.getByText("This is the plan summary.")).toBeDefined();
  });

  it("does not render a summary section when absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryAllByTestId("markdown-content").length).toBe(0);
  });

  it("renders requirements traceability when present", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2." }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2.")).toBeDefined();
  });

  it("does not render requirements traceability section when absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders steps with numbering, title, and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Set up scaffolding", description: "Create the base files." },
            { id: "s2", title: "Wire up API", description: "Connect to backend." },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Set up scaffolding")).toBeDefined();
    expect(screen.getByText("Wire up API")).toBeDefined();
    expect(screen.getByText("Create the base files.")).toBeDefined();
  });

  it("does not render the Steps section when steps is empty", () => {
    render(<PlanView plan={{ steps: [] }} />);
    expect(screen.queryByText("Steps")).toBeNull();
  });

  it("renders assumptions as a bulleted list", () => {
    render(
      <PlanView plan={{ assumptions: ["Node 22 is available", "CI has network access"] }} />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Node 22 is available")).toBeDefined();
    expect(screen.getByText("CI has network access")).toBeDefined();
  });

  it("does not render the Assumptions section when empty", () => {
    render(<PlanView plan={{ assumptions: [] }} />);
    expect(screen.queryByText("Assumptions")).toBeNull();
  });

  it("renders risks as a bulleted list", () => {
    render(<PlanView plan={{ risks: ["Rate limiting may occur"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Rate limiting may occur")).toBeDefined();
  });

  it("does not render the Risks section when empty", () => {
    render(<PlanView plan={{ risks: [] }} />);
    expect(screen.queryByText("Risks")).toBeNull();
  });

  it("renders open questions with the required-for-execution badge", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which environment?", requiredForExecution: true },
            { id: "q2", question: "Any budget constraints?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("Which environment?")).toBeDefined();
    expect(screen.getByText("Any budget constraints?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not show the blocks-execution badge for non-required questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Any budget constraints?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.queryByText("blocks execution")).toBeNull();
  });

  it("does not render the Open Questions section when empty", () => {
    render(<PlanView plan={{ openQuestions: [] }} />);
    expect(screen.queryByText("Open Questions")).toBeNull();
  });

  it("renders a fully populated plan end to end", () => {
    render(
      <PlanView
        plan={{
          planVersion: 2,
          confidence: 0.9,
          summary: "Full plan summary",
          requirementsTraceability: "Traces all reqs",
          steps: [{ id: "s1", title: "Step one", description: "Do the thing" }],
          assumptions: ["Assumption A"],
          risks: ["Risk A"],
          openQuestions: [
            { id: "q1", question: "Question A", requiredForExecution: true },
          ],
        }}
      />,
    );
    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("90%")).toBeDefined();
    expect(screen.getByText("Full plan summary")).toBeDefined();
    expect(screen.getByText("Traces all reqs")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("Assumption A")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();
    expect(screen.getByText("Question A")).toBeDefined();
  });
});
