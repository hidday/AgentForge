import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies active-category badge/dot classes and the pulse animation for an active state", () => {
    render(<StateBadge state="Planning" />);
    const badge = screen.getByText("Planning").closest("span");
    expect(badge).not.toBeNull();
    expect(badge?.className).toContain("bg-state-active-bg");
    expect(badge?.className).toContain("text-state-active");

    const dot = badge?.querySelector("span");
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("bg-state-active");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not apply the pulse animation for a non-active (waiting) state", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    const badge = screen.getByText("Awaiting Plan Approval").closest("span");
    const dot = badge?.querySelector("span");
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("bg-state-waiting");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("applies blocked-category classes for a blocked state", () => {
    render(<StateBadge state="AIBlocked" />);
    const badge = screen.getByText("AI Blocked").closest("span");
    expect(badge?.className).toContain("bg-state-blocked-bg");
    expect(badge?.className).toContain("text-state-blocked");
    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("bg-state-blocked");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("applies done-category classes for the Done state", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge?.className).toContain("bg-state-done-bg");
    expect(badge?.className).toContain("text-state-done");
  });

  it("applies idle-category classes for an unknown state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const badge = screen.getByText("Some Unknown State").closest("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
    expect(badge?.className).toContain("text-state-idle");
  });

  it("merges a passed className into the root element's classes", () => {
    render(<StateBadge state="Todo" className="my-custom-class" />);
    const badge = screen.getByText("Todo").closest("span");
    expect(badge?.className).toContain("my-custom-class");
  });
});
