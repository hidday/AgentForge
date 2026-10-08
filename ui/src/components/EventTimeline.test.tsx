import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function ev(id: string, eventType: string, payloadJson: unknown = null, source = "system"): RunEventRecord {
  return { id, runId: "r1", eventType, source, payloadJson, createdAt: new Date().toISOString() };
}

describe("EventTimeline", () => {
  it("shows an empty state", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeTruthy();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("lists events newest-first with formatted names", () => {
    render(
      <EventTimeline
        events={[ev("1", "RUN_REQUESTED"), ev("2", "PLAN_CREATED"), ev("3", "EXECUTION_FINISHED")]}
      />,
    );
    const titles = screen
      .getAllByText(/Run Requested|Plan Created|Execution Finished/)
      .map((n) => n.textContent);
    expect(titles).toEqual(["Execution Finished", "Plan Created", "Run Requested"]);
    expect(screen.getAllByText("just now")).toHaveLength(3);
  });

  it("shows state transitions only when both from and to exist", () => {
    render(
      <EventTimeline
        events={[
          ev("1", "PLAN_APPROVED", { from: "AwaitingPlanApproval", to: "Implementing" }),
          ev("2", "PLAN_REVISED", { to: "PlanReview" }),
        ]}
      />,
    );
    expect(screen.getByText("AwaitingPlanApproval")).toBeTruthy();
    expect(screen.getByText("Implementing")).toBeTruthy();
    expect(screen.queryByText("PlanReview")).toBeNull();
  });

  it("shows feedback only for PLAN_REJECTED events", () => {
    render(
      <EventTimeline
        events={[
          ev("1", "PLAN_REJECTED", { feedback: "Needs more tests" }, "human"),
          ev("2", "BLOCKED", { feedback: "should not show" }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more tests")).toBeTruthy();
    expect(screen.queryByText("should not show")).toBeNull();
    expect(screen.getByText("human")).toBeTruthy();
  });

  it.each([
    ["PLAN_APPROVED", "text-state-done"],
    ["REMEDIATION_FINISHED", "text-state-done"],
    ["REVIEW_CHANGES_REQUESTED", "text-state-blocked"],
    ["PLAN_REJECTED", "text-state-blocked"],
    ["BLOCKED", "text-state-blocked"],
    ["SOMETHING_ELSE", "text-accent"],
  ])("colors %s icon with %s", (type, cls) => {
    const { container } = render(<EventTimeline events={[ev("1", type)]} />);
    const icon = container.querySelector("svg")!;
    expect(icon.getAttribute("class")).toContain(cls);
  });
});
