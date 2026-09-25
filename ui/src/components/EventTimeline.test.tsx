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
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders 'No events yet' when the events list is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText(/No events yet/i)).toBeDefined();
  });

  it("renders events in reverse-chronological order (most recent first)", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:01:00Z" }),
      makeEvent({ id: "e3", eventType: "PLAN_APPROVED", createdAt: "2024-01-01T00:02:00Z" }),
    ];
    render(<EventTimeline events={events} />);

    const headings = screen.getAllByText(/Run Requested|Plan Created|Plan Approved/);
    const texts = headings.map((el) => el.textContent);
    expect(texts).toEqual(["Plan Approved", "Plan Created", "Run Requested"]);
  });

  it("formats SNAKE_CASE event types to Title Case", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "EXECUTION_FINISHED" })]}
      />,
    );
    expect(screen.getByText("Execution Finished")).toBeDefined();
  });

  it("renders the source label for each event", () => {
    render(<EventTimeline events={[makeEvent({ source: "human" })]} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("renders from/to transition payload when present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "AIBlocked", to: "Todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("AIBlocked")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("does not render from/to transition block when payload lacks from/to", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ eventType: "RUN_REQUESTED", payloadJson: { foo: "bar" } })]}
      />,
    );
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("renders feedback text for PLAN_REJECTED events with feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail on rollout" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail on rollout")).toBeDefined();
  });

  it("does not render feedback block for non-PLAN_REJECTED events even with feedback in payload", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "REVIEW_CHANGES_REQUESTED",
            payloadJson: { feedback: "Should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("Should not show")).toBeNull();
  });

  it("uses the done color for APPROVED / EXECUTION_FINISHED / REMEDIATION_FINISHED event types", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({ id: "a", eventType: "PLAN_APPROVED" }),
          makeEvent({ id: "b", eventType: "EXECUTION_FINISHED" }),
          makeEvent({ id: "c", eventType: "REMEDIATION_FINISHED" }),
        ]}
      />,
    );
    const icons = container.querySelectorAll("svg.text-state-done");
    // 3 events reversed, each has one leading state icon in done color
    expect(icons.length).toBe(3);
  });

  it("uses the blocked color for REJECTED / CHANGES_REQUESTED / BLOCKED event types", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({ id: "a", eventType: "PLAN_REJECTED" }),
          makeEvent({ id: "b", eventType: "REVIEW_CHANGES_REQUESTED" }),
          makeEvent({ id: "c", eventType: "BLOCKED" }),
        ]}
      />,
    );
    const icons = container.querySelectorAll("svg.text-state-blocked");
    expect(icons.length).toBe(3);
  });

  it("falls back to the accent color for other event types", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "RUN_REQUESTED" })]} />,
    );
    expect(container.querySelectorAll("svg.text-accent").length).toBeGreaterThan(0);
  });

  it("falls back to the Bot icon-styled source for unmapped sources", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ source: "ai-agent" })]} />,
    );
    // Bot icon rendered for unmapped source; lucide renders svg with class 'lucide-bot'
    expect(container.querySelector("svg.lucide-bot")).not.toBeNull();
  });

  it("uses the User icon for human / user-command sources", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ source: "human" })]} />,
    );
    expect(container.querySelector("svg.lucide-user")).not.toBeNull();
  });

  it("falls back to the Zap icon for unmapped event types", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_TYPE" })]} />,
    );
    expect(container.querySelector("svg.lucide-zap")).not.toBeNull();
  });

  it("renders the relative time with the absolute timestamp as a title attribute", () => {
    render(<EventTimeline events={[makeEvent({ createdAt: "2024-01-01T00:00:00Z" })]} />);
    const timeEl = screen.getByText(/ago|just now/i);
    expect(timeEl.getAttribute("title")).toBeTruthy();
  });
});
