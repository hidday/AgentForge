import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
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

  it("opens an EventSource connection to the events stream endpoint", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses an incoming message and forwards it to the callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;

    const payload: DashboardEvent = { type: "run:created", runId: "r1" };
    source.onmessage!({ data: JSON.stringify(payload) });

    expect(onEvent).toHaveBeenCalledWith(payload);
  });

  it("silently ignores a malformed (non-JSON) message", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;

    expect(() => source.onmessage!({ data: "not valid json" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the connection errors", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;
    expect(() => source.onerror!()).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });

  it("does not open a new connection when the callback identity changes across renders", () => {
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: vi.fn() },
    });
    expect(FakeEventSource.instances).toHaveLength(1);

    rerender({ cb: vi.fn() });
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("always invokes the latest callback passed in, even after a re-render", () => {
    const firstCb = vi.fn();
    const secondCb = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: firstCb },
    });
    rerender({ cb: secondCb });

    const source = FakeEventSource.instances[0]!;
    const payload: DashboardEvent = { type: "run:created", runId: "r2" };
    source.onmessage!({ data: JSON.stringify(payload) });

    expect(firstCb).not.toHaveBeenCalled();
    expect(secondCb).toHaveBeenCalledWith(payload);
  });
});
