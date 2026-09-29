import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the humanized state name", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the animate-pulse-dot class to the dot for active-category states", () => {
    const { container } = render(<StateBadge state="Implementing" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not apply the pulse animation for non-active-category states", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("falls back to the idle category for an unrecognized state", () => {
    const { container } = render(<StateBadge state="SomeUnknownState" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("state-idle");
    expect(screen.getByText("Some Unknown State")).toBeDefined();
  });

  it("merges an additional className onto the badge", () => {
    const { container } = render(<StateBadge state="Done" className="custom-class" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("custom-class");
  });
});
