import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

interface Case {
  state: string;
  label: string;
  badgeClass: string;
  dotClass: string;
  isActive: boolean;
}

// One case per state defined in `stateColors.ts`'s STATE_CATEGORIES map, plus
// an unmapped state to exercise the "idle" fallback.
const cases: Case[] = [
  { state: "Todo", label: "Todo", badgeClass: "state-idle", dotClass: "bg-state-idle", isActive: false },
  { state: "Planning", label: "Planning", badgeClass: "state-active", dotClass: "bg-state-active", isActive: true },
  { state: "PlanReview", label: "Plan Review", badgeClass: "state-active", dotClass: "bg-state-active", isActive: true },
  { state: "PlanRevision", label: "Plan Revision", badgeClass: "state-active", dotClass: "bg-state-active", isActive: true },
  { state: "AwaitingPlanApproval", label: "Awaiting Plan Approval", badgeClass: "state-waiting", dotClass: "bg-state-waiting", isActive: false },
  { state: "Implementing", label: "Implementing", badgeClass: "state-active", dotClass: "bg-state-active", isActive: true },
  { state: "AIReview", label: "A I Review", badgeClass: "state-active", dotClass: "bg-state-active", isActive: true },
  { state: "AddressingReview", label: "Addressing Review", badgeClass: "state-active", dotClass: "bg-state-active", isActive: true },
  { state: "ReadyForHumanReview", label: "Ready For Human Review", badgeClass: "state-waiting", dotClass: "bg-state-waiting", isActive: false },
  { state: "Done", label: "Done", badgeClass: "state-done", dotClass: "bg-state-done", isActive: false },
  { state: "AIBlocked", label: "A I Blocked", badgeClass: "state-blocked", dotClass: "bg-state-blocked", isActive: false },
  { state: "HumanClarificationNeeded", label: "Human Clarification Needed", badgeClass: "state-waiting", dotClass: "bg-state-waiting", isActive: false },
];

describe("StateBadge", () => {
  it.each(cases)(
    "renders '$state' with label '$label', $badgeClass styling, and isActive=$isActive",
    ({ state, label, badgeClass, dotClass, isActive }) => {
      render(<StateBadge state={state} />);

      const badge = screen.getByText(label);
      expect(badge.className).toContain(badgeClass);

      const dot = badge.querySelector("span");
      expect(dot).not.toBeNull();
      expect(dot!.className).toContain(dotClass);

      if (isActive) {
        expect(dot!.className).toContain("animate-pulse-dot");
      } else {
        expect(dot!.className).not.toContain("animate-pulse-dot");
      }
    },
  );

  it("falls back to the idle category and a spaced-out label for an unrecognized state", () => {
    render(<StateBadge state="SomeUnknownState" />);

    const badge = screen.getByText("Some Unknown State");
    expect(badge.className).toContain("state-idle");
    const dot = badge.querySelector("span");
    expect(dot!.className).toContain("bg-state-idle");
    expect(dot!.className).not.toContain("animate-pulse-dot");
  });

  it("applies an additional className passed in via props", () => {
    render(<StateBadge state="Done" className="extra-class" />);
    expect(screen.getByText("Done").className).toContain("extra-class");
  });
});
