import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders nothing extra for a plan with no optional fields", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(screen.queryByText("Requirements Traceability")).toBeNull();
    // header row still renders (empty) without crashing
    expect(container.querySelector(".space-y-5")).not.toBeNull();
  });

  it("shows the plan version when provided", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders a high-confidence bar in the done color", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.85 }} />);
    expect(screen.getByText("85%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders a mid-confidence bar in the waiting color", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a low-confidence bar in the blocked color", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.2 }} />);
    expect(screen.getByText("20%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary text", () => {
    render(<PlanView plan={{ summary: "Do the thing safely." }} />);
    expect(screen.getByText("Do the thing safely.")).toBeDefined();
  });

  it("renders requirements traceability under its own heading", () => {
    render(
      <PlanView
        plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2." }}
      />,
    );
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText("Covers REQ-1 and REQ-2.")).toBeDefined();
  });

  it("renders numbered steps with title and description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Step one", description: "First description" },
            { id: "s2", title: "Step two", description: "Second description" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
    expect(screen.getByText("Step one")).toBeDefined();
    expect(screen.getByText("Second description")).toBeDefined();
  });

  it("renders assumptions as a bulleted list", () => {
    render(
      <PlanView plan={{ assumptions: ["Assumes CI is green", "Assumes staging exists"] }} />,
    );
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Assumes CI is green")).toBeDefined();
    expect(screen.getByText("Assumes staging exists")).toBeDefined();
  });

  it("renders risks as a bulleted list", () => {
    render(<PlanView plan={{ risks: ["Might break auth"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Might break auth")).toBeDefined();
  });

  it("marks required open questions as blocking execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which env?", requiredForExecution: true },
          ],
        }}
      />,
    );
    expect(screen.getByText("Which env?")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
  });

  it("does not mark optional open questions as blocking execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Any nice-to-haves?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Any nice-to-haves?")).toBeDefined();
    expect(screen.queryByText("blocks execution")).toBeNull();
  });
});
