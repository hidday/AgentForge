import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

describe("useSSE", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("subscribes to the events stream on mount", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("calls the callback with the parsed event when a message arrives", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    source.onmessage!({ data: JSON.stringify(event) });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("ignores malformed message data without throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0]!;
    expect(() => source.onmessage!({ data: "{not valid json" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the source errors", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0]!;
    expect(() => source.onerror!()).not.toThrow();
  });

  it("closes the connection on unmount", () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0]!;
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });

  it("uses the latest callback without resubscribing when onEvent changes", () => {
    const onEvent1 = vi.fn();
    const onEvent2 = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: onEvent1 },
    });

    expect(FakeEventSource.instances).toHaveLength(1);

    rerender({ cb: onEvent2 });
    // Still only one EventSource — no resubscription on callback change.
    expect(FakeEventSource.instances).toHaveLength(1);

    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    source.onmessage!({ data: JSON.stringify(event) });

    expect(onEvent1).not.toHaveBeenCalled();
    expect(onEvent2).toHaveBeenCalledWith(event);
  });
});
