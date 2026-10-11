import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "e1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventTimeline additional branches", () => {
  it("applies the 'done' icon color for an *_APPROVED event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_APPROVED" })]} />,
    );
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("class")).toContain("text-state-done");
  });

  it("applies the 'done' icon color for an EXECUTION_FINISHED event", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "EXECUTION_FINISHED" })]} />,
    );
    const icon = container.querySelector("svg");
    expect(icon!.getAttribute("class")).toContain("text-state-done");
  });

  it("applies the 'done' icon color for a REMEDIATION_FINISHED event", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "REMEDIATION_FINISHED" })]} />,
    );
    const icon = container.querySelector("svg");
    expect(icon!.getAttribute("class")).toContain("text-state-done");
  });
});
