import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "./PlanView.tsx";

describe("PlanView", () => {
  it("renders with an empty plan object without crashing, and shows no optional sections", () => {
    const { container } = render(<PlanView plan={{}} />);
    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Assumptions")).toBeNull();
    expect(screen.queryByText("Risks")).toBeNull();
    expect(screen.queryByText("Open Questions")).toBeNull();
    expect(container.querySelector(".tabular-nums")).toBeNull();
  });

  it("renders the plan version when present", () => {
    render(<PlanView plan={{ planVersion: 3 }} />);
    expect(screen.getByText("v3")).toBeDefined();
  });

  it("renders a high-confidence bar in the 'done' color for confidence >= 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.9 }} />);
    expect(screen.getByText("90%")).toBeDefined();
    expect(container.querySelector(".bg-state-done")).not.toBeNull();
  });

  it("renders a medium-confidence bar in the 'waiting' color for 0.4 <= confidence < 0.7", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.5 }} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(container.querySelector(".bg-state-waiting")).not.toBeNull();
  });

  it("renders a low-confidence bar in the 'blocked' color for confidence < 0.4", () => {
    const { container } = render(<PlanView plan={{ confidence: 0.1 }} />);
    expect(screen.getByText("10%")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders the summary as markdown", () => {
    render(<PlanView plan={{ summary: "This is the **plan** summary." }} />);
    const strong = screen.getByText("plan");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.closest("p")?.textContent).toBe("This is the plan summary.");
  });

  it("renders requirements traceability when present", () => {
    render(<PlanView plan={{ requirementsTraceability: "Covers REQ-1 and REQ-2." }} />);
    expect(screen.getByText("Requirements Traceability")).toBeDefined();
    expect(screen.getByText(/Covers REQ-1 and REQ-2/)).toBeDefined();
  });

  it("renders numbered steps with title and markdown description", () => {
    render(
      <PlanView
        plan={{
          steps: [
            { id: "s1", title: "Write tests", description: "Add unit tests for the parser." },
            { id: "s2", title: "Ship it", description: "Open a PR." },
          ],
        }}
      />,
    );
    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Write tests")).toBeDefined();
    expect(screen.getByText("Ship it")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("2.")).toBeDefined();
  });

  it("renders assumptions as a bulleted list", () => {
    render(<PlanView plan={{ assumptions: ["Node 22 is available", "CI has network access"] }} />);
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Node 22 is available")).toBeDefined();
    expect(screen.getByText("CI has network access")).toBeDefined();
  });

  it("renders risks as a bulleted list", () => {
    render(<PlanView plan={{ risks: ["Migration could be lossy"] }} />);
    expect(screen.getByText("Risks")).toBeDefined();
    expect(screen.getByText("Migration could be lossy")).toBeDefined();
  });

  it("renders open questions, flagging ones required for execution", () => {
    render(
      <PlanView
        plan={{
          openQuestions: [
            { id: "q1", question: "Which env?", requiredForExecution: true },
            { id: "q2", question: "Any perf constraints?", requiredForExecution: false },
          ],
        }}
      />,
    );
    expect(screen.getByText("Open Questions")).toBeDefined();
    expect(screen.getByText("blocks execution")).toBeDefined();
    // Only one question should be flagged as blocking.
    expect(screen.getAllByText("blocks execution").length).toBe(1);
  });
});
