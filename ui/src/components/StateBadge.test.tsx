import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted label for a simple state", () => {
    render(<StateBadge state="Done" />);
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("renders the formatted (spaced) label for a multi-word state", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active badge class and pulses the dot for an active state", () => {
    const { container } = render(<StateBadge state="Implementing" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-active-bg");

    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("bg-state-active");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("applies the waiting badge class and does not pulse the dot", () => {
    const { container } = render(<StateBadge state="ReadyForHumanReview" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-waiting-bg");

    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("bg-state-waiting");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("applies the blocked badge class for a blocked state", () => {
    const { container } = render(<StateBadge state="AIBlocked" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-blocked-bg");
    expect(screen.getByText("A I Blocked")).toBeDefined();
  });

  it("applies the done badge class for a done state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-done-bg");
  });

  it("falls back to the idle badge class for an unknown state", () => {
    const { container } = render(<StateBadge state="SomethingUnrecognized" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-idle-bg");

    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("bg-state-idle");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("merges a custom className onto the badge", () => {
    const { container } = render(<StateBadge state="Todo" className="custom-class" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("custom-class");
  });
});
