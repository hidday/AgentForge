import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name with spaces inserted before capitals", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("marks an active-category state with the pulsing dot animation", () => {
    render(<StateBadge state="Implementing" />);
    const dot = screen.getByText("Implementing").firstElementChild as HTMLElement;
    expect(dot.className).toContain("animate-pulse-dot");
  });

  it("does not pulse a non-active-category state (e.g. waiting)", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    const dot = screen.getByText("Awaiting Plan Approval").firstElementChild as HTMLElement;
    expect(dot.className).not.toContain("animate-pulse-dot");
  });

  it("does not pulse the done category", () => {
    render(<StateBadge state="Done" />);
    const dot = screen.getByText("Done").firstElementChild as HTMLElement;
    expect(dot.className).not.toContain("animate-pulse-dot");
  });

  it("does not pulse the blocked category", () => {
    render(<StateBadge state="AIBlocked" />);
    const dot = screen.getByText("AI Blocked").firstElementChild as HTMLElement;
    expect(dot.className).not.toContain("animate-pulse-dot");
  });

  it("falls back to the idle category for an unknown state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    // idle category never pulses
    const dot = screen.getByText("Some Unknown State").firstElementChild as HTMLElement;
    expect(dot.className).not.toContain("animate-pulse-dot");
  });

  it("applies an additional className passed through props", () => {
    render(<StateBadge state="Todo" className="extra-class" />);
    expect(screen.getByText("Todo").className).toContain("extra-class");
  });
});
