import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted label for every known state", () => {
    const cases: Array<[string, string]> = [
      ["Todo", "Todo"],
      ["Planning", "Planning"],
      ["PlanReview", "Plan Review"],
      ["PlanRevision", "Plan Revision"],
      ["AwaitingPlanApproval", "Awaiting Plan Approval"],
      ["Implementing", "Implementing"],
      ["AIReview", "A I Review"],
      ["AddressingReview", "Addressing Review"],
      ["ReadyForHumanReview", "Ready For Human Review"],
      ["Done", "Done"],
      ["AIBlocked", "A I Blocked"],
      ["HumanClarificationNeeded", "Human Clarification Needed"],
    ];

    for (const [state, label] of cases) {
      const { unmount } = render(<StateBadge state={state} />);
      expect(screen.getByText(label)).toBeDefined();
      unmount();
    }
  });

  it("falls back to the idle category styling for an unknown state", () => {
    const { container } = render(<StateBadge state="SomeUnknownState" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
    expect(screen.getByText("Some Unknown State")).toBeDefined();
  });

  it("applies the pulse-dot animation class only for active-category states", () => {
    const { container: activeContainer } = render(<StateBadge state="Planning" />);
    const activeDot = activeContainer.querySelector("span > span");
    expect(activeDot?.className).toContain("animate-pulse-dot");

    const { container: doneContainer } = render(<StateBadge state="Done" />);
    const doneDot = doneContainer.querySelector("span > span");
    expect(doneDot?.className).not.toContain("animate-pulse-dot");
  });

  it("merges an additional className prop", () => {
    const { container } = render(<StateBadge state="Todo" className="my-extra-class" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("my-extra-class");
  });
});
