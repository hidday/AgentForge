import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the animate-pulse-dot class only for active-category states", () => {
    const { container: activeContainer } = render(<StateBadge state="Implementing" />);
    const activeDot = activeContainer.querySelector("span > span");
    expect(activeDot?.className).toContain("animate-pulse-dot");

    const { container: doneContainer } = render(<StateBadge state="Done" />);
    const doneDot = doneContainer.querySelector("span > span");
    expect(doneDot?.className).not.toContain("animate-pulse-dot");
  });

  it("applies the state-specific badge color class", () => {
    render(<StateBadge state="AIBlocked" />);
    const badge = screen.getByText("A I Blocked").closest("span");
    expect(badge?.className).toContain("bg-state-blocked-bg");
  });

  it("merges an additional className prop", () => {
    render(<StateBadge state="Done" className="extra-class" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge?.className).toContain("extra-class");
  });
});
