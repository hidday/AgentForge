import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name for a camel-case state", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active pulse-dot class for an active-category state", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not apply the pulse-dot class for a non-active state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("falls back to idle styling for an unknown state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    expect(screen.getByText("Some Unknown State")).toBeDefined();
  });

  it("merges a custom className via cn()", () => {
    const { container } = render(<StateBadge state="Done" className="my-extra-class" />);
    expect(container.querySelector("span")?.className).toContain("my-extra-class");
  });
});
