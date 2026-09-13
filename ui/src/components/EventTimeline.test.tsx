import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { EventTimeline } from "./EventTimeline.tsx";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: overrides.id ?? `evt-${Math.random()}`,
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "system",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders the empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText(/No events yet/i)).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders events in reverse (most-recent-first) order", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:01:00Z" }),
      makeEvent({ id: "e3", eventType: "PLAN_APPROVED", createdAt: "2024-01-01T00:02:00Z" }),
    ];
    render(<EventTimeline events={events} />);

    const headings = screen.getAllByText(/Run Requested|Plan Created|Plan Approved/);
    const labels = headings.map((el) => el.textContent);
    expect(labels).toEqual(["Plan Approved", "Plan Created", "Run Requested"]);
  });

  it("does not mutate the original events array when reversing for display", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED" }),
    ];
    const originalOrder = events.map((e) => e.id);
    render(<EventTimeline events={events} />);
    expect(events.map((e) => e.id)).toEqual(originalOrder);
  });

  it("formats event type by replacing underscores and title-casing words", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "NEEDS_HUMAN_CLARIFICATION" })]}
      />,
    );
    expect(screen.getByText("Needs Human Clarification")).toBeDefined();
  });

  it("falls back to the Zap icon's accent color styling for an unrecognized event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />,
    );
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("class")).toContain("text-accent");
  });

  it("applies done styling for APPROVED, EXECUTION_FINISHED and REMEDIATION_FINISHED event types", () => {
    const events = [
      makeEvent({ id: "a", eventType: "PLAN_REVIEW_APPROVED" }),
      makeEvent({ id: "b", eventType: "EXECUTION_FINISHED" }),
      makeEvent({ id: "c", eventType: "REMEDIATION_FINISHED" }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    const icons = container.querySelectorAll("svg.text-state-done");
    expect(icons.length).toBe(3);
  });

  it("applies blocked styling for REJECTED, CHANGES_REQUESTED and BLOCKED event types", () => {
    const events = [
      makeEvent({ id: "a", eventType: "PLAN_REJECTED" }),
      makeEvent({ id: "b", eventType: "REVIEW_CHANGES_REQUESTED" }),
      makeEvent({ id: "c", eventType: "BLOCKED" }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    const icons = container.querySelectorAll("svg.text-state-blocked");
    expect(icons.length).toBe(3);
  });

  it("uses the mapped icon for known event types (e.g. AlertTriangle for BLOCKED)", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />,
    );
    // lucide AlertTriangle renders a path with a distinctive class name on the svg tag
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("lucide-triangle-alert");
  });

  it("renders the from/to transition row only when both payload.from and payload.to are present", () => {
    const withTransition = makeEvent({
      id: "t1",
      eventType: "RESET_TO_TODO",
      payloadJson: { from: "IN_PROGRESS", to: "TODO" },
    });
    const withoutTransition = makeEvent({
      id: "t2",
      eventType: "RUN_REQUESTED",
      payloadJson: { from: "IN_PROGRESS" }, // missing `to`
    });
    render(<EventTimeline events={[withTransition, withoutTransition]} />);

    expect(screen.getByText("IN_PROGRESS")).toBeDefined();
    expect(screen.getByText("TODO")).toBeDefined();
    // Only one occurrence of "IN_PROGRESS" text since the second event's
    // transition row is suppressed (missing `to`)
    expect(screen.getAllByText("IN_PROGRESS").length).toBe(1);
  });

  it("renders the PLAN_REJECTED feedback quote only for that event type when feedback is present", () => {
    const rejectedWithFeedback = makeEvent({
      id: "r1",
      eventType: "PLAN_REJECTED",
      payloadJson: { feedback: "Please redo the plan" },
    });
    const otherEventWithFeedback = makeEvent({
      id: "r2",
      eventType: "PLAN_APPROVED",
      payloadJson: { feedback: "Should not render for this type" },
    });
    render(<EventTimeline events={[rejectedWithFeedback, otherEventWithFeedback]} />);

    expect(screen.getByText("Please redo the plan")).toBeDefined();
    expect(screen.queryByText("Should not render for this type")).toBeNull();
  });

  it("does not render a feedback quote for PLAN_REJECTED when payload.feedback is absent", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_REJECTED", payloadJson: {} })]}
      />,
    );
    expect(screen.getByText("Plan Rejected")).toBeDefined();
    expect(screen.queryByText(/italic/)).toBeNull();
  });

  it("handles a null payloadJson without throwing and renders event source and relative time", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RUN_REQUESTED",
            source: "human",
            payloadJson: null,
            createdAt: new Date(Date.now() - 5000).toISOString(),
          }),
        ]}
      />,
    );
    expect(screen.getByText("human")).toBeDefined();
    expect(screen.getByText("just now")).toBeDefined();
  });

  it("uses the User icon for human and user-command sources, and Bot icon for other sources", () => {
    const events = [
      makeEvent({ id: "s1", eventType: "HUMAN_APPROVED", source: "human" }),
      makeEvent({ id: "s2", eventType: "RUN_REQUESTED", source: "user-command" }),
      makeEvent({ id: "s3", eventType: "RUN_REQUESTED", source: "agent" }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    const userIcons = container.querySelectorAll("svg.lucide-user");
    const botIcons = container.querySelectorAll("svg.lucide-bot");
    expect(userIcons.length).toBe(2);
    expect(botIcons.length).toBe(1);
  });

  it("shows the formatted absolute timestamp as a title attribute on the relative time span", () => {
    const createdAt = "2024-01-01T00:00:00.000Z";
    render(
      <EventTimeline events={[makeEvent({ eventType: "RUN_REQUESTED", createdAt })]} />,
    );
    const relativeEl = screen.getByText(/ago|just now/i);
    expect(relativeEl.getAttribute("title")).toBe(
      new Date(createdAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
  });
});
