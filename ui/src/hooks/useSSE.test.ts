import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

// ---------------------------------------------------------------------------
// Fake EventSource
// ---------------------------------------------------------------------------
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

describe("useSSE", () => {
  it("opens an EventSource against the dashboard stream endpoint", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("invokes the callback with the parsed event on message", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    source.onmessage!({ data: JSON.stringify(event) });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed JSON in a message event", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;

    expect(() => source.onmessage!({ data: "{not valid json" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the source reports an error", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;
    expect(() => source.onerror!()).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;
    expect(source.close).not.toHaveBeenCalled();
    unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it("does not open a new EventSource when the callback identity changes across renders", () => {
    const { rerender } = renderHook(({ cb }: { cb: (e: DashboardEvent) => void }) => useSSE(cb), {
      initialProps: { cb: vi.fn() },
    });
    rerender({ cb: vi.fn() });
    rerender({ cb: vi.fn() });
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("always dispatches to the latest callback, not a stale closure", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: (e: DashboardEvent) => void }) => useSSE(cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });

    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-2" };
    source.onmessage!({ data: JSON.stringify(event) });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });
});
