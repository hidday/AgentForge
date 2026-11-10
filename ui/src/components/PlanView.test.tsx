import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

// Mock Markdown so we can assert its content directly without relying on
// markdown rendering semantics (consistent with other tests in this package).
import { vi } from "vitest";
vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("PlanView", () => {
  it("renders an empty plan without crashing and without optional sections", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(container.firstChild).not.toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
  });

  it("renders the plan version when provided", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("does not render a version tag when planVersion is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d+$/)).toBeNull();
  });

  it("renders the confidence bar and percentage with done styling when confidence is high", () => {
    render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("renders the confidence bar with waiting styling for mid-range confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    const bar = container.querySelector(".bg-state-waiting");
    expect(bar).not.toBeNull();
  });

  it("renders the confidence bar with blocked styling for low confidence", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
    const bar = container.querySelector(".bg-state-blocked");
    expect(bar).not.toBeNull();
  });

  it("does not render confidence UI when confidence is absent", () => {
    render(<PlanView plan={{}} />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it("renders the summary via Markdown when present", () => {
    render(<PlanView plan={{ summary: "This plan adds a new endpoint." }} />);
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(
      markdownEls.some((el) => el.textContent === "This plan adds a new endpoint."),
    ).toBe(true);
  });

  it("renders requirements traceability section when present", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2." }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(
      markdownEls.some((el) => el.textContent === "Covers REQ-1 and REQ-2."),
    ).toBe(true);
  });

  it("renders steps with index numbering, title, and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Add schema", description: "Create the table." },
            { id: "s2", title: "Add route", description: "Wire up the endpoint." },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Add schema")).toBeDefined();
    expect(screen.getByText("Add route")).toBeDefined();
  });

  it("renders assumptions list items", () => {
    render(
      <PlanView
        plan={{ assumptions: ["The DB is already migrated.", "Auth is handled upstream."] }}
      />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(
      markdownEls.some((el) => el.textContent === "The DB is already migrated."),
    ).toBe(true);
    expect(
      markdownEls.some((el) => el.textContent === "Auth is handled upstream."),
    ).toBe(true);
  });

  it("renders risks list items", () => {
    render(
      <PlanView plan={{ risks: ["Migration could lock the table."] }} />,
    );
    expect(screen.getByText("Risks")).toBeDefined();
    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(
      markdownEls.some((el) => el.textContent === "Migration could lock the table."),
    ).toBe(true);
  });

  it("renders open questions, marking required ones as blocking execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which region?", requiredForExecution: true },
            { id: "q2", question: "Any style guide?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();

    const markdownEls = screen.getAllByTestId("markdown-content");
    expect(markdownEls.some((el) => el.textContent === "Which region?")).toBe(true);
    expect(markdownEls.some((el) => el.textContent === "Any style guide?")).toBe(true);
  });

  it("does not show 'blocks execution' label for non-required open questions", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Any style guide?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.queryByText("blocks execution")).toBeNull();
  });

  it("renders a full plan with every section populated together", () => {
    render(
      <PlanView
        plan={{
          planVersion: 2,
          confidence: 0.9,
          summary: "Summary text",
          requirementsTraceability: "Trace text",
          steps: [{ id: "s1", title: "Step one", description: "Desc one" }],
          assumptions: ["Assumption one"],
          risks: ["Risk one"],
          openQuestions: [
            { id: "q1", question: "Question one", requiredForExecution: true },
          ],
        }}
      />,
    );

    expect(screen.getByText("v2")).toBeDefined();
    expect(screen.getByText("90%")).toBeDefined();
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Open Questions")).toBeDefined();
  });
});
