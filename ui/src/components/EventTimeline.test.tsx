import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "system",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders events in reverse order (most recent first)", () => {
    const events = [
      makeEvent({ id: "ev-1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "ev-2", eventType: "PLAN_CREATED" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("renders a known icon-mapped event type with done styling for an approved event", () => {
    const events = [
      makeEvent({ eventType: "PLAN_REVIEW_APPROVED", source: "human" }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    expect(screen.getByText("Plan Review Approved")).toBeDefined();
    const icon = container.querySelector("svg.text-state-done");
    expect(icon).not.toBeNull();
  });

  it("renders EXECUTION_FINISHED and REMEDIATION_FINISHED with done styling", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "EXECUTION_FINISHED" }),
      makeEvent({ id: "e2", eventType: "REMEDIATION_FINISHED" }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    const doneIcons = container.querySelectorAll("svg.text-state-done");
    expect(doneIcons.length).toBe(2);
  });

  it("renders rejected/changes-requested/blocked events with blocked styling", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "PLAN_REJECTED" }),
      makeEvent({ id: "e2", eventType: "REVIEW_CHANGES_REQUESTED" }),
      makeEvent({ id: "e3", eventType: "BLOCKED" }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    const blockedIcons = container.querySelectorAll("svg.text-state-blocked");
    expect(blockedIcons.length).toBe(3);
  });

  it("renders an unmapped event type with default accent styling and Bot source icon", () => {
    const events = [
      makeEvent({ eventType: "SOME_UNKNOWN_EVENT", source: "ai" }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
    const accentIcon = container.querySelector("svg.text-accent");
    expect(accentIcon).not.toBeNull();
  });

  it("renders human source icon for human source", () => {
    const events = [makeEvent({ source: "human" })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("renders user-command source", () => {
    const events = [makeEvent({ source: "user-command" })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("renders from/to transition payload when present", () => {
    const events = [
      makeEvent({
        eventType: "RESET_TO_TODO",
        payloadJson: { from: "Planning", to: "Todo" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("renders feedback text for PLAN_REJECTED with feedback payload", () => {
    const events = [
      makeEvent({
        eventType: "PLAN_REJECTED",
        payloadJson: { feedback: "Needs more detail" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Needs more detail")).toBeDefined();
  });

  it("does not render feedback block when PLAN_REJECTED has no feedback", () => {
    const events = [
      makeEvent({ eventType: "PLAN_REJECTED", payloadJson: null }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    expect(container.querySelector("p.italic")).toBeNull();
  });

  it("shows the relative time with a formatted timestamp title", () => {
    const events = [
      makeEvent({ createdAt: new Date(Date.now() - 5000).toISOString() }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("just now")).toBeDefined();
  });
});
