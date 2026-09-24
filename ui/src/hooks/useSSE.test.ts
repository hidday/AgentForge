import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
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
    expect(FakeEventSource.instances[0].url).toBe("/api/events/stream");
  });

  it("invokes the callback with the parsed event when a message arrives", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0];
    const dashboardEvent: DashboardEvent = { type: "run:created", runId: "run-1" };
    source.onmessage?.({ data: JSON.stringify(dashboardEvent) });

    expect(onEvent).toHaveBeenCalledWith(dashboardEvent);
  });

  it("silently ignores malformed JSON messages", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0];
    expect(() => source.onmessage?.({ data: "not valid json" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when onerror fires (auto-reconnect is left to the browser)", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0];
    expect(() => source.onerror?.()).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0];

    unmount();

    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it("always calls the latest callback passed in, even after a rerender", () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();

    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: firstCallback },
    });

    rerender({ cb: secondCallback });

    const source = FakeEventSource.instances[0];
    const dashboardEvent: DashboardEvent = { type: "run:created", runId: "run-1" };
    source.onmessage?.({ data: JSON.stringify(dashboardEvent) });

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledWith(dashboardEvent);
  });

  it("only opens a single EventSource connection even when the callback identity changes", () => {
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: vi.fn() },
    });

    rerender({ cb: vi.fn() });
    rerender({ cb: vi.fn() });

    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
