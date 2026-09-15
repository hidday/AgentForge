import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";

// Mock lucide-react so each icon renders as an identifiable, dependency-version-agnostic
// element that still forwards `className` (used to assert color logic).
vi.mock("lucide-react", () => {
  function makeIcon(name: string) {
    return function MockIcon({ className }: { className?: string }) {
      return <div data-testid={`icon-${name}`} className={className} />;
    };
  }
  return {
    Zap: makeIcon("zap"),
    FileText: makeIcon("file-text"),
    CheckCircle2: makeIcon("check-circle-2"),
    XCircle: makeIcon("x-circle"),
    AlertTriangle: makeIcon("alert-triangle"),
    User: makeIcon("user"),
    Bot: makeIcon("bot"),
    ArrowRight: makeIcon("arrow-right"),
  };
});

import { EventTimeline } from "./EventTimeline.tsx";

function makeEvent(overrides: Partial<RunEventRecord> & { id: string }): RunEventRecord {
  return {
    id: overrides.id,
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders 'No events yet' for an empty array", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders events newest-first with formatted event type labels", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:01.000Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:00:02.000Z" }),
    ];
    const { container } = render(<EventTimeline events={events} />);

    expect(screen.getByText("Run Requested")).toBeDefined();
    expect(screen.getByText("Plan Created")).toBeDefined();

    const html = container.innerHTML;
    // Reversed: the second (newer) event's label must appear before the first's.
    expect(html.indexOf("Plan Created")).toBeLessThan(html.indexOf("Run Requested"));
  });

  it("renders the from/to transition arrow when payload has from and to", () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: "e1",
        eventType: "PLAN_CREATED",
        payloadJson: { from: "Todo", to: "Planning" },
      }),
    ];
    render(<EventTimeline events={events} />);

    expect(screen.getByText("Todo")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByTestId("icon-arrow-right")).toBeDefined();
  });

  it("does not render the transition arrow when payload has no from/to", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", payloadJson: null }),
    ];
    render(<EventTimeline events={events} />);

    expect(screen.queryByTestId("icon-arrow-right")).toBeNull();
  });

  it("renders PLAN_REJECTED feedback as an italic note", () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: "e1",
        eventType: "PLAN_REJECTED",
        payloadJson: { feedback: "Needs more detail on rollout." },
      }),
    ];
    render(<EventTimeline events={events} />);

    const note = screen.getByText("Needs more detail on rollout.");
    expect(note.className).toContain("italic");
  });

  it("does not render a feedback note for non PLAN_REJECTED events even with feedback present", () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: "e1",
        eventType: "PLAN_REVIEW_APPROVED",
        payloadJson: { feedback: "Should not show" },
      }),
    ];
    render(<EventTimeline events={events} />);

    expect(screen.queryByText("Should not show")).toBeNull();
  });

  it.each([
    ["PLAN_REVIEW_APPROVED", "check-circle-2"],
    ["EXECUTION_FINISHED", "check-circle-2"],
    ["REMEDIATION_FINISHED", "check-circle-2"],
  ])("colors %s icon done-green", (eventType, iconName) => {
    const events: RunEventRecord[] = [makeEvent({ id: "e1", eventType })];
    render(<EventTimeline events={events} />);

    const icon = screen.getByTestId(`icon-${iconName}`);
    expect(icon.className).toContain("text-state-done");
  });

  it.each([
    ["PLAN_REJECTED", "x-circle"],
    ["REVIEW_CHANGES_REQUESTED", "x-circle"],
    ["BLOCKED", "alert-triangle"],
  ])("colors %s icon blocked-red", (eventType, iconName) => {
    const events: RunEventRecord[] = [makeEvent({ id: "e1", eventType })];
    render(<EventTimeline events={events} />);

    const icon = screen.getByTestId(`icon-${iconName}`);
    expect(icon.className).toContain("text-state-blocked");
  });

  it("colors an unmatched event type icon with the default accent color", () => {
    const events: RunEventRecord[] = [makeEvent({ id: "e1", eventType: "RUN_REQUESTED" })];
    render(<EventTimeline events={events} />);

    const icon = screen.getByTestId("icon-zap");
    expect(icon.className).toContain("text-accent");
    expect(icon.className).not.toContain("text-state-done");
    expect(icon.className).not.toContain("text-state-blocked");
  });

  it.each(["human", "user-command"])(
    "renders the User source icon for source '%s'",
    (source) => {
      const events: RunEventRecord[] = [makeEvent({ id: "e1", source })];
      render(<EventTimeline events={events} />);

      expect(screen.getByTestId("icon-user")).toBeDefined();
      expect(screen.queryByTestId("icon-bot")).toBeNull();
    },
  );

  it("renders the Bot source icon for a non-human source", () => {
    const events: RunEventRecord[] = [makeEvent({ id: "e1", source: "ai-agent" })];
    render(<EventTimeline events={events} />);

    expect(screen.getByTestId("icon-bot")).toBeDefined();
    expect(screen.queryByTestId("icon-user")).toBeNull();
  });
});
