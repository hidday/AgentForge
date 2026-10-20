import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { EventTimeline } from "./EventTimeline.tsx";

function makeEvent(
  overrides: Partial<RunEventRecord> & { id: string; eventType: string },
): RunEventRecord {
  return {
    id: overrides.id,
    runId: "run-1",
    eventType: overrides.eventType,
    source: overrides.source ?? "ai",
    payloadJson: overrides.payloadJson ?? null,
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
  };
}

describe("EventTimeline", () => {
  it("renders 'No events yet' when events array is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText(/No events yet/i)).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders the Events heading and each event's formatted type when events are present", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:01Z" }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Events")).toBeDefined();
    // formatEventType: RUN_REQUESTED -> "Run Requested"
    expect(screen.getByText("Run Requested")).toBeDefined();
  });

  it("renders events newest-first (reversed from the input array order)", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:01Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:00:02Z" }),
      makeEvent({ id: "e3", eventType: "PLAN_APPROVED", createdAt: "2024-01-01T00:00:03Z" }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    const titles = Array.from(
      container.querySelectorAll(".text-xs.font-medium.text-text-primary"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Plan Approved", "Plan Created", "Run Requested"]);
  });

  it("applies the done color for an APPROVED-type event", () => {
    const events = [makeEvent({ id: "e1", eventType: "PLAN_APPROVED" })];
    const { container } = render(<EventTimeline events={events} />);
    const icon = container.querySelector("svg.text-state-done");
    expect(icon).not.toBeNull();
  });

  it("applies the done color for EXECUTION_FINISHED and REMEDIATION_FINISHED", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "EXECUTION_FINISHED" }),
      makeEvent({ id: "e2", eventType: "REMEDIATION_FINISHED" }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    const icons = container.querySelectorAll("svg.text-state-done");
    expect(icons.length).toBe(2);
  });

  it("applies the blocked color for REJECTED, CHANGES_REQUESTED, and BLOCKED event types", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "PLAN_REJECTED" }),
      makeEvent({ id: "e2", eventType: "REVIEW_CHANGES_REQUESTED" }),
      makeEvent({ id: "e3", eventType: "BLOCKED" }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    const icons = container.querySelectorAll("svg.text-state-blocked");
    expect(icons.length).toBe(3);
  });

  it("falls back to the accent color for an event type matching no special rule", () => {
    const events = [makeEvent({ id: "e1", eventType: "RUN_REQUESTED" })];
    const { container } = render(<EventTimeline events={events} />);
    expect(container.querySelector("svg.text-accent")).not.toBeNull();
  });

  it("falls back to the default Zap icon for an unrecognized event type and still renders it", () => {
    const events = [makeEvent({ id: "e1", eventType: "SOME_UNKNOWN_EVENT" })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });

  it("shows the event source text, using known icons for human/user-command and falling back for others", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", source: "human" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", source: "user-command" }),
      makeEvent({ id: "e3", eventType: "EXECUTION_STARTED", source: "ai" }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("human")).toBeDefined();
    expect(screen.getByText("user-command")).toBeDefined();
    expect(screen.getByText("ai")).toBeDefined();
  });

  it("renders from/to transition when payload has both fields", () => {
    const events = [
      makeEvent({
        id: "e1",
        eventType: "RESET_TO_TODO",
        payloadJson: { from: "Implementing", to: "Todo" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("does not render a transition when payload is missing from/to", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", payloadJson: { feedback: "hi" } }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("renders feedback text only for PLAN_REJECTED events with feedback in the payload", () => {
    const events = [
      makeEvent({
        id: "e1",
        eventType: "PLAN_REJECTED",
        payloadJson: { feedback: "Please add more test coverage" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Please add more test coverage")).toBeDefined();
  });

  it("does not render feedback for a non-PLAN_REJECTED event even if payload has feedback", () => {
    const events = [
      makeEvent({
        id: "e1",
        eventType: "REVIEW_CHANGES_REQUESTED",
        payloadJson: { feedback: "Should not show" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.queryByText("Should not show")).toBeNull();
  });

  it("shows a title attribute with the formatted timestamp on the relative time element", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    const timeEl = container.querySelector("span[title]");
    expect(timeEl).not.toBeNull();
    expect(timeEl?.getAttribute("title")).toMatch(/Jan/);
  });
});
