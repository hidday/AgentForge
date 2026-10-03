import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted label for a known idle state", () => {
    render(<StateBadge state="Todo" />);
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("splits camel-case state names into words", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("renders an animated dot for active-category states", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const dot = container.querySelector("span.animate-pulse-dot");
    expect(dot).not.toBeNull();
  });

  it("does not animate the dot for non-active states (e.g. done)", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span.animate-pulse-dot");
    expect(dot).toBeNull();
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("falls back to the idle category for an unknown state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    // formatStateName splits on capital letters
    expect(screen.getByText("Some Unknown State")).toBeDefined();
  });

  it("applies an additional className when provided", () => {
    const { container } = render(
      <StateBadge state="Done" className="custom-class" />,
    );
    expect(container.querySelector("span.custom-class")).not.toBeNull();
  });
});
