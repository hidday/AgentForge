import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name", () => {
    render(<StateBadge state="PlanReview" />);
    expect(screen.getByText("Plan Review")).toBeDefined();
  });

  it("applies the active pulse animation only for active-category states", () => {
    const { container: active } = render(<StateBadge state="Implementing" />);
    const activeDot = active.querySelectorAll("span")[1];
    expect(activeDot.className).toContain("animate-pulse-dot");

    const { container: done } = render(<StateBadge state="Done" />);
    const doneDot = done.querySelectorAll("span")[1];
    expect(doneDot.className).not.toContain("animate-pulse-dot");
  });

  it("merges a custom className onto the badge", () => {
    const { container } = render(<StateBadge state="Todo" className="my-custom-class" />);
    expect(container.querySelector(".my-custom-class")).not.toBeNull();
  });

  it("falls back to idle styling for an unknown state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    expect(screen.getByText("Some Unknown State")).toBeDefined();
  });
});
