import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name with spaces inserted before capitals", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the pulsing dot class for active-category states", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not apply the pulsing dot class for non-active states (e.g. Done)", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("falls back to the idle category for an unrecognized state", () => {
    const { container } = render(<StateBadge state="SomeUnknownState" />);
    const badge = container.firstElementChild;
    expect(badge?.className).toContain("state-idle");
  });

  it("forwards an additional className onto the badge", () => {
    const { container } = render(<StateBadge state="Done" className="custom-class" />);
    expect(container.firstElementChild?.className).toContain("custom-class");
  });
});
