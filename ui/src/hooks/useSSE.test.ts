import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }

  emitError() {
    this.onerror?.(new Event("error"));
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

  it("opens a connection to the events stream URL on mount", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("invokes the callback with the parsed event when a message arrives", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    FakeEventSource.instances[0]!.emitMessage(event);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("ignores malformed (non-JSON) message payloads without throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    expect(() => FakeEventSource.instances[0]!.emitMessage("not valid json {{{")).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the connection errors, and keeps the connection open", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    expect(() => FakeEventSource.instances[0]!.emitError()).not.toThrow();
    expect(FakeEventSource.instances[0]!.closed).toBe(false);
  });

  it("closes the EventSource on unmount", () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() => useSSE(onEvent));

    const instance = FakeEventSource.instances[0]!;
    expect(instance.closed).toBe(false);

    unmount();

    expect(instance.closed).toBe(true);
  });

  it("always calls the latest callback without re-opening the connection when it changes", () => {
    const onEventA = vi.fn();
    const onEventB = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: (e: DashboardEvent) => void }) => useSSE(cb), {
      initialProps: { cb: onEventA },
    });

    expect(FakeEventSource.instances).toHaveLength(1);

    rerender({ cb: onEventB });

    // Still just one EventSource instance - it isn't recreated on callback change.
    expect(FakeEventSource.instances).toHaveLength(1);

    const event: DashboardEvent = { type: "run:created", runId: "r2" };
    FakeEventSource.instances[0]!.emitMessage(event);

    expect(onEventA).not.toHaveBeenCalled();
    expect(onEventB).toHaveBeenCalledWith(event);
  });
});
