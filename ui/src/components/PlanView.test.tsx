import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock Markdown so we can assert on its rendered text content directly,
// following the convention used in ChatPanel.test.tsx.
vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children, className }: { children: string; className?: string }) => (
    <div data-testid="markdown" className={className}>
      {children}
    </div>
  ),
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing section-wise for a completely empty plan", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(screen.queryByText(/Steps/)).toBeNull();
    expect(screen.queryByText(/Assumptions/)).toBeNull();
    expect(screen.queryByText(/Risks/)).toBeNull();
    expect(screen.queryByText(/Open Questions/)).toBeNull();
    expect(screen.queryByText(/Requirements Traceability/)).toBeNull();
    expect(screen.queryByText(/^v\d/)).toBeNull();
    // Root wrapper still renders (header row), just with empty content
    expect(container.firstChild).not.toBeNull();
  });

  it("renders the plan version when planVersion is present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render a version label when planVersion is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d+$/)).toBeNull();
  });

  describe("confidence indicator", () => {
    it("renders high confidence (>= 0.7) with the done color and rounded percentage", () => {
      const { container } = render(<PlanView plan={{ confidence: 0.86 }} />);
      expect(screen.getByText("86%")).toBeDefined();
      const bar = container.querySelector(".bg-state-done");
      expect(bar).not.toBeNull();
      expect((bar as HTMLElement).style.width).toBe("86%");
    });

    it("renders mid confidence (0.4 - 0.69) with the waiting color", () => {
      const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
      expect(screen.getByText("50%")).toBeDefined();
      expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
    });

    it("renders low confidence (< 0.4) with the blocked color", () => {
      const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
      expect(screen.getByText("10%")).toBeDefined();
      expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
    });

    it("renders nothing confidence-related when confidence is absent", () => {
      render(<PlanView plan={{}} />);
      expect(screen.queryByText(/%$/)).toBeNull();
    });
  });

  it("renders the summary via Markdown", () => {
    render(<PlanView plan={{ summary: "This is the plan summary." }} />);
    const el = screen.getByTestId("markdown");
    expect(el.textContent).toBe("This is the plan summary.");
  });

  it("does not render a summary block when summary is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByTestId("markdown")).toBeNull();
  });

  it("renders the Requirements Traceability section when present", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2." }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2.")).toBeDefined();
  });

  it("omits the Requirements Traceability section when absent", () => {
    render(<PlanView plan={{ summary: "x" }} />);
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  describe("steps", () => {
    const steps = [
      { id: "s1", title: "Set up schema", description: "Add the migration." },
      { id: "s2", title: "Implement handler", description: "Write the route." },
    ];

    it("renders the Steps heading and each step numbered with title and description", () => {
      render(<PlanView plan={{ steps }} />);
      expect(screen.getByText("Steps")).toBeDefined();
      expect(screen.getByText("1.")).toBeDefined();
      expect(screen.getByText("2.")).toBeDefined();
      expect(screen.getByText("Set up schema")).toBeDefined();
      expect(screen.getByText("Add the migration.")).toBeDefined();
      expect(screen.getByText("Implement handler")).toBeDefined();
      expect(screen.getByText("Write the route.")).toBeDefined();
    });

    it("omits the Steps section when steps is empty", () => {
      render(<PlanView plan={{ steps: [] }} />);
      expect(screen.queryByText("Steps")).toBeNull();
    });
  });

  describe("assumptions", () => {
    it("renders each assumption as a bullet list item", () => {
      render(
        <PlanView plan={{ assumptions: ["API is stable", "No downtime required"] }} />,
      );
      expect(screen.getByText("Assumptions")).toBeDefined();
      expect(screen.getByText("API is stable")).toBeDefined();
      expect(screen.getByText("No downtime required")).toBeDefined();
    });

    it("omits the Assumptions section when empty", () => {
      render(<PlanView plan={{ assumptions: [] }} />);
      expect(screen.queryByText("Assumptions")).toBeNull();
    });
  });

  describe("risks", () => {
    it("renders each risk as a bullet list item", () => {
      render(<PlanView plan={{ risks: ["Data loss on migration"] }} />);
      expect(screen.getByText("Risks")).toBeDefined();
      expect(screen.getByText("Data loss on migration")).toBeDefined();
    });

    it("omits the Risks section when empty", () => {
      render(<PlanView plan={{ risks: [] }} />);
      expect(screen.queryByText("Risks")).toBeNull();
    });
  });

  describe("open questions", () => {
    it("renders a question that blocks execution with the 'blocks execution' label", () => {
      render(
        <PlanView
          plan={{
            openQuestions: [
              { id: "q1", question: "Which region?", requiredForExecution: true },
            ],
          }}
        />,
      );
      expect(screen.getByText("Open Questions")).toBeDefined();
      expect(screen.getByText("Which region?")).toBeDefined();
      expect(screen.getByText("blocks execution")).toBeDefined();
    });

    it("renders a non-required question without the 'blocks execution' label", () => {
      render(
        <PlanView
          plan={{
            openQuestions: [
              { id: "q2", question: "Preferred color?", requiredForExecution: false },
            ],
          }}
        />,
      );
      expect(screen.getByText("Preferred color?")).toBeDefined();
      expect(screen.queryByText("blocks execution")).toBeNull();
    });

    it("omits the Open Questions section when empty", () => {
      render(<PlanView plan={{ openQuestions: [] }} />);
      expect(screen.queryByText("Open Questions")).toBeNull();
    });
  });

  it("renders a fully populated plan with all sections together", () => {
    render(
      <PlanView
        plan={{
          planVersion: 2,
          confidence: 0.75,
          summary: "Overall summary",
          requirementsTraceability: "Traces REQ-9",
          steps: [{ id: "s1", title: "Step one", description: "Do the thing" }],
          assumptions: ["Assumption A"],
          risks: ["Risk A"],
          openQuestions: [
            { id: "q1", question: "Question A?", requiredForExecution: true },
          ],
        }}
      />,
    );

    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("75%")).toBeDefined();
    expect(screen.getByText("Overall summary")).toBeDefined();
    expect(screen.getByText("Traces REQ-9")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("Assumption A")).toBeDefined();
    expect(screen.getByText("Risk A")).toBeDefined();
    expect(screen.getByText("Question A?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });
});
