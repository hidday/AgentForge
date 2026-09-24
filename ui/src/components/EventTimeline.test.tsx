import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(
  overrides: Partial<RunEventRecord> & Pick<RunEventRecord, "id" | "eventType">,
): RunEventRecord {
  return {
    id: overrides.id,
    runId: "run-1",
    eventType: overrides.eventType,
    source: overrides.source ?? "system",
    payloadJson: overrides.payloadJson ?? null,
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
  };
}

describe("EventTimeline", () => {
  it("renders 'No events yet' when the events array is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText(/No events yet/i)).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders the header and formats event types into title case with spaces", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "RUN_REQUESTED" })]}
      />,
    );
    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Run Requested")).toBeDefined();
  });

  it("renders events newest-first (reversed relative to the input array)", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
          makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:01:00Z" }),
        ]}
      />,
    );

    const labels = screen.getAllByText(/Requested|Created/);
    expect(labels[0].textContent).toBe("Plan Created");
    expect(labels[1].textContent).toBe("Run Requested");
  });

  it("shows the from/to transition when payload has both", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "AIBlocked", to: "Todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("AIBlocked")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("does not show a transition when payload is missing from/to", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "BLOCKED", payloadJson: null })]}
      />,
    );
    // No mono-font transition spans should be present
    expect(container.querySelectorAll(".font-mono").length).toBe(0);
  });

  it("shows italic feedback text only for PLAN_REJECTED events with feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more error handling" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more error handling")).toBeDefined();
  });

  it("does not show feedback text for PLAN_REJECTED without a feedback payload", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "PLAN_REJECTED", payloadJson: null })]}
      />,
    );
    expect(screen.queryByText(/error handling/i)).toBeNull();
  });

  it("does not show feedback text for non-PLAN_REJECTED events even with a feedback field", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
            eventType: "BLOCKED",
            payloadJson: { feedback: "Should not render" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("Should not render")).toBeNull();
  });

  it("renders the event source label", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "HUMAN_APPROVED", source: "human" })]}
      />,
    );
    expect(screen.getByText("human")).toBeDefined();
  });

  it("applies done-state icon coloring for APPROVED / EXECUTION_FINISHED / REMEDIATION_FINISHED events", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({ id: "e1", eventType: "PLAN_REVIEW_APPROVED" }),
          makeEvent({ id: "e2", eventType: "EXECUTION_FINISHED" }),
          makeEvent({ id: "e3", eventType: "REMEDIATION_FINISHED" }),
        ]}
      />,
    );
    const cards = container.querySelectorAll(".group");
    for (const card of Array.from(cards)) {
      const icon = card.querySelector("svg");
      expect(icon?.getAttribute("class")).toContain("text-state-done");
    }
  });

  it("applies blocked-state icon coloring for REJECTED / CHANGES_REQUESTED / BLOCKED events", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({ id: "e1", eventType: "PLAN_REJECTED" }),
          makeEvent({ id: "e2", eventType: "REVIEW_CHANGES_REQUESTED" }),
          makeEvent({ id: "e3", eventType: "BLOCKED" }),
        ]}
      />,
    );
    const cards = container.querySelectorAll(".group");
    for (const card of Array.from(cards)) {
      const icon = card.querySelector("svg");
      expect(icon?.getAttribute("class")).toContain("text-state-blocked");
    }
  });

  it("falls back to accent icon coloring for other event types", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ id: "e1", eventType: "EXECUTION_STARTED" })]} />,
    );
    const icon = container.querySelector(".group svg");
    expect(icon?.getAttribute("class")).toContain("text-accent");
  });

  it("renders an unrecognized event type using the default icon and formatted label", () => {
    render(
      <EventTimeline events={[makeEvent({ id: "e1", eventType: "SOME_NEW_EVENT" })]} />,
    );
    expect(screen.getByText("Some New Event")).toBeDefined();
  });
});
