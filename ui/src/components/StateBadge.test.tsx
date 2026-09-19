import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders a formatted label for a known active state and applies the pulse-dot class", () => {
    const { container } = render(<StateBadge state="Planning" />);
    expect(screen.getByText("Planning")).toBeDefined();
    const dot = container.querySelector("span span");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("splits camelCase state names into separate words", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("does not apply the pulse-dot class for a non-active state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("falls back to the idle category and passes through an unknown state's own label", () => {
    const { container } = render(<StateBadge state="SomeUnknownState" />);
    expect(screen.getByText("Some Unknown State")).toBeDefined();
    expect(container.querySelector("span")?.className).toContain("bg-state-idle-bg");
  });

  it("merges a custom className onto the badge", () => {
    const { container } = render(<StateBadge state="Todo" className="my-extra-class" />);
    expect(container.querySelector("span")?.className).toContain("my-extra-class");
  });
});
