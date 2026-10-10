import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name as text", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("renders a single-word state name without a leading space", () => {
    render(<StateBadge state="Todo" />);
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("applies the category-derived badge class and dot class for an active state", () => {
    render(<StateBadge state="Implementing" />);
    const badge = screen.getByText("Implementing").closest("span");
    expect(badge).toBeDefined();
    expect(badge!.className).toContain("bg-state-active-bg");
    expect(badge!.className).toContain("text-state-active");

    const dot = badge!.querySelector("span");
    expect(dot).toBeDefined();
    expect(dot!.className).toContain("bg-state-active");
    expect(dot!.className).toContain("animate-pulse-dot");
  });

  it("does not animate the dot for a non-active (done) state category", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done").closest("span");
    const dot = badge!.querySelector("span");
    expect(dot!.className).toContain("bg-state-done");
    expect(dot!.className).not.toContain("animate-pulse-dot");
  });

  it("falls back to the idle category for an unrecognized state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const badge = screen.getByText("Some Unknown State").closest("span");
    expect(badge!.className).toContain("bg-state-idle-bg");
  });

  it("merges a custom className onto the badge", () => {
    render(<StateBadge state="Todo" className="my-extra-class" />);
    const badge = screen.getByText("Todo").closest("span");
    expect(badge!.className).toContain("my-extra-class");
  });
});
