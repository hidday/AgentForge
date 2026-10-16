import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function latestSource(): MockEventSource {
  const source = MockEventSource.instances[MockEventSource.instances.length - 1];
  if (!source) throw new Error("no EventSource instance created");
  return source;
}

describe("useSSE", () => {
  it("opens an EventSource pointed at the dashboard stream endpoint", () => {
    renderHook(() => useSSE(() => {}));

    expect(MockEventSource.instances.length).toBe(1);
    expect(latestSource().url).toBe("/api/events/stream");
  });

  it("parses incoming messages as JSON and forwards them to the callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    latestSource().onmessage!({ data: JSON.stringify(event) });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("ignores malformed (non-JSON) message payloads without throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    expect(() => {
      latestSource().onmessage!({ data: "not-json{{{" });
    }).not.toThrow();

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the source reports an error", () => {
    renderHook(() => useSSE(() => {}));

    expect(() => {
      latestSource().onerror!();
    }).not.toThrow();
  });

  it("uses the latest callback without re-subscribing on re-render", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: (e: DashboardEvent) => void }) => useSSE(cb), {
      initialProps: { cb: cb1 },
    });

    expect(MockEventSource.instances.length).toBe(1);

    rerender({ cb: cb2 });

    // Still only one EventSource was ever created.
    expect(MockEventSource.instances.length).toBe(1);

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    latestSource().onmessage!({ data: JSON.stringify(event) });

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledWith(event);
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(() => {}));
    const source = latestSource();

    expect(source.close).not.toHaveBeenCalled();
    unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
  });
});
