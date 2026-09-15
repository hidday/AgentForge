import { describe, it, expect, vi, beforeEach } from "vitest";
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

  it("opens an EventSource against /api/events/stream on mount", () => {
    renderHook(() => useSSE(() => {}));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(() => {}));
    const instance = FakeEventSource.instances[0]!;
    expect(instance.closed).toBe(false);
    unmount();
    expect(instance.closed).toBe(true);
  });

  it("invokes the callback with the parsed event on a valid message", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const instance = FakeEventSource.instances[0]!;

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    instance.onmessage!({ data: JSON.stringify(event) });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed (non-JSON) message data", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const instance = FakeEventSource.instances[0]!;

    expect(() => instance.onmessage!({ data: "not json" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when onerror fires (auto-reconnect is a no-op)", () => {
    renderHook(() => useSSE(() => {}));
    const instance = FakeEventSource.instances[0]!;
    expect(() => instance.onerror!()).not.toThrow();
  });

  it("always calls the latest callback without reopening the connection when the callback identity changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });
    expect(FakeEventSource.instances).toHaveLength(1);

    rerender({ cb: second });
    // Still only one EventSource — effect with [] deps doesn't re-run.
    expect(FakeEventSource.instances).toHaveLength(1);

    const instance = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-2" };
    instance.onmessage!({ data: JSON.stringify(event) });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });
});
