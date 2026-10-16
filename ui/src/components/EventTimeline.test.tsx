import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { EventTimeline } from "./EventTimeline.tsx";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "evt-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline – empty state", () => {
  it("shows 'No events yet' when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("does not render the Events header in the empty state", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.queryByText("Events")).toBeNull();
  });
});

describe("EventTimeline – ordering", () => {
  it("renders the most recently created event first (reverse chronological)", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:01:00Z" }),
      makeEvent({ id: "e3", eventType: "EXECUTION_STARTED", createdAt: "2024-01-01T00:02:00Z" }),
    ];
    render(<EventTimeline events={events} />);

    const titles = screen
      .getAllByText(/Run Requested|Plan Created|Execution Started/)
      .map((el) => el.textContent);

    expect(titles).toEqual(["Execution Started", "Plan Created", "Run Requested"]);
  });

  it("shows the Events header when there is at least one event", () => {
    render(<EventTimeline events={[makeEvent()]} />);
    expect(screen.getByText("Events")).toBeDefined();
  });
});

describe("EventTimeline – event type formatting", () => {
  it("formats a snake-case event type into title case", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_REVIEW_CHANGES_REQUESTED" })]} />);
    expect(screen.getByText("Plan Review Changes Requested")).toBeDefined();
  });

  it("falls back to the default icon/color for an unrecognised event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />,
    );
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
    // unrecognised types fall into the default "text-accent" branch
    expect(container.querySelector("svg.text-accent")).not.toBeNull();
  });
});

describe("EventTimeline – icon color branches", () => {
  it("colors an APPROVED-style event as done", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_APPROVED" })]} />,
    );
    expect(container.querySelector("svg.text-state-done")).not.toBeNull();
  });

  it("colors EXECUTION_FINISHED as done", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "EXECUTION_FINISHED" })]} />,
    );
    expect(container.querySelector("svg.text-state-done")).not.toBeNull();
  });

  it("colors REMEDIATION_FINISHED as done", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "REMEDIATION_FINISHED" })]} />,
    );
    expect(container.querySelector("svg.text-state-done")).not.toBeNull();
  });

  it("colors a REJECTED-style event as blocked", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_REJECTED" })]} />,
    );
    expect(container.querySelector("svg.text-state-blocked")).not.toBeNull();
  });

  it("colors a CHANGES_REQUESTED-style event as blocked", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "REVIEW_CHANGES_REQUESTED" })]} />,
    );
    expect(container.querySelector("svg.text-state-blocked")).not.toBeNull();
  });

  it("colors a BLOCKED event as blocked", () => {
    const { container } = render(<EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />);
    expect(container.querySelector("svg.text-state-blocked")).not.toBeNull();
  });
});

describe("EventTimeline – payload rendering", () => {
  it("renders a from/to transition when both are present in the payload", () => {
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

  it("does not render a from/to row when payload is null", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "RUN_REQUESTED", payloadJson: null })]} />,
    );
    // no font-mono spans are rendered for the (absent) from/to row
    expect(container.querySelectorAll("span.font-mono").length).toBe(0);
  });

  it("does not render a from/to row when only one of from/to is present", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ eventType: "RESET_TO_TODO", payloadJson: { from: "AIBlocked" } })]}
      />,
    );
    expect(container.querySelectorAll("span.font-mono").length).toBe(0);
  });

  it("renders feedback text for a PLAN_REJECTED event with feedback in the payload", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Please use a different approach" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Please use a different approach")).toBeDefined();
  });

  it("does not render feedback for other event types even if present in the payload", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "REVIEW_CHANGES_REQUESTED",
            payloadJson: { feedback: "Irrelevant feedback" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("Irrelevant feedback")).toBeNull();
  });
});

describe("EventTimeline – source rendering", () => {
  it("shows the event source text", () => {
    render(<EventTimeline events={[makeEvent({ source: "human" })]} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("shows a non-human source (e.g. an agent) as its raw source string", () => {
    render(<EventTimeline events={[makeEvent({ source: "orchestrator" })]} />);
    expect(screen.getByText("orchestrator")).toBeDefined();
  });

  it("shows user-command as a source", () => {
    render(<EventTimeline events={[makeEvent({ source: "user-command" })]} />);
    expect(screen.getByText("user-command")).toBeDefined();
  });
});

describe("EventTimeline – timestamp rendering", () => {
  it("renders a relative time string and a full timestamp title", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ createdAt: "2024-01-01T00:00:00Z" })]} />,
    );
    const timeEl = container.querySelector("span[title]");
    expect(timeEl).not.toBeNull();
    expect(timeEl?.getAttribute("title")).toMatch(/Jan/);
    expect(timeEl?.textContent).toMatch(/ago|just now/);
  });
});
