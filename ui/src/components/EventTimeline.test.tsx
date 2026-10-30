import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { EventTimeline } from "./EventTimeline.tsx";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "system",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders 'No events yet' empty state when events array is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText(/No events yet/i)).toBeDefined();
  });

  it("renders events in reverse order (most recent first)", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "ev-1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "ev-2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:01:00Z" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("formats event type by replacing underscores and title-casing", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_REVIEW_APPROVED" })]} />);
    expect(screen.getByText("Plan Review Approved")).toBeDefined();
  });

  it("uses the done-colored icon for an event type containing APPROVED", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_REVIEW_APPROVED" })]} />);
    const icon = document.querySelector("svg.text-state-done");
    expect(icon).not.toBeNull();
  });

  it("uses the done-colored icon for EXECUTION_FINISHED", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "EXECUTION_FINISHED" })]} />);
    expect(document.querySelector("svg.text-state-done")).not.toBeNull();
  });

  it("uses the done-colored icon for REMEDIATION_FINISHED", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "REMEDIATION_FINISHED" })]} />);
    expect(document.querySelector("svg.text-state-done")).not.toBeNull();
  });

  it("uses the blocked-colored icon for an event type containing REJECTED", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_REJECTED" })]} />);
    expect(document.querySelector("svg.text-state-blocked")).not.toBeNull();
  });

  it("uses the blocked-colored icon for an event type containing CHANGES_REQUESTED", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "REVIEW_CHANGES_REQUESTED" })]} />);
    expect(document.querySelector("svg.text-state-blocked")).not.toBeNull();
  });

  it("uses the blocked-colored icon for BLOCKED", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />);
    expect(document.querySelector("svg.text-state-blocked")).not.toBeNull();
  });

  it("uses the default accent-colored icon for an unmapped/neutral event type", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "RESET_TO_TODO" })]} />);
    expect(document.querySelector("svg.text-accent")).not.toBeNull();
  });

  it("falls back to the Zap icon for an unknown event type", () => {
    const { container } = render(<EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });

  it("uses the human SourceIcon for source 'human'", () => {
    const { container } = render(<EventTimeline events={[makeEvent({ source: "human" })]} />);
    expect(screen.getByText("human")).toBeDefined();
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
  });

  it("uses the human SourceIcon for source 'user-command'", () => {
    render(<EventTimeline events={[makeEvent({ source: "user-command" })]} />);
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("falls back to the Bot SourceIcon for an unmapped source", () => {
    render(<EventTimeline events={[makeEvent({ source: "ai-agent" })]} />);
    expect(screen.getByText("ai-agent")).toBeDefined();
  });

  it("renders from/to transition when payload has both from and to", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "Implementing", to: "Todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("does not render from/to transition when payload is missing to", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "RESET_TO_TODO", payloadJson: { from: "Implementing" } })]}
      />,
    );
    expect(screen.queryByText("Implementing")).toBeNull();
  });

  it("does not render from/to transition when payloadJson is null", () => {
    render(<EventTimeline events={[makeEvent({ payloadJson: null })]} />);
    expect(screen.queryByText(/ArrowRight/)).toBeNull();
  });

  it("renders feedback text for PLAN_REJECTED when payload has feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({ eventType: "PLAN_REJECTED", payloadJson: { feedback: "Needs more detail" } }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail")).toBeDefined();
  });

  it("does not render feedback for PLAN_REJECTED when payload has no feedback", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_REJECTED", payloadJson: {} })]} />);
    expect(screen.queryByText("Needs more detail")).toBeNull();
  });

  it("does not render feedback block for event types other than PLAN_REJECTED even with feedback payload", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_CREATED", payloadJson: { feedback: "ignored" } })]}
      />,
    );
    expect(screen.queryByText("ignored")).toBeNull();
  });

  it("shows a relative time with a full timestamp as the title attribute", () => {
    render(<EventTimeline events={[makeEvent({ createdAt: "2024-01-01T00:00:00Z" })]} />);
    const timeEl = screen.getByText(/ago|just now/i);
    expect(timeEl.getAttribute("title")).toMatch(/Jan/);
  });
});
