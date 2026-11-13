import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name with spaces inserted before capitals", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("renders a single-word state name unchanged", () => {
    render(<StateBadge state="Done" />);
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("applies the pulsing-dot class for an active-category state", () => {
    const { container } = render(<StateBadge state="Implementing" />);
    const dot = container.querySelector("span > span");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("animate-pulse-dot");
  });

  it("does not apply the pulsing-dot class for a non-active-category state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span > span");
    expect(dot).not.toBeNull();
    expect(dot!.className).not.toContain("animate-pulse-dot");
  });

  it("merges an extra className onto the badge", () => {
    const { container } = render(<StateBadge state="Todo" className="my-extra-class" />);
    const badge = container.querySelector("span");
    expect(badge!.className).toContain("my-extra-class");
  });

  it("falls back to the idle category styling for an unknown state", () => {
    const { container } = render(<StateBadge state="SomeUnknownState" />);
    expect(screen.getByText("Some Unknown State")).toBeDefined();
    const badge = container.querySelector("span");
    expect(badge!.className).toContain("state-idle");
  });
});
