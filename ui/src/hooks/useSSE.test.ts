import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((msg: { data: string }) => void) | null = null;
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

describe("useSSE", () => {
  it("opens a single EventSource on the dashboard stream", () => {
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: vi.fn() },
    });
    rerender({ cb: vi.fn() });
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses messages and forwards them to the callback", () => {
    const cb = vi.fn();
    renderHook(() => useSSE(cb));
    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    MockEventSource.instances[0]!.onmessage!({ data: JSON.stringify(event) });
    expect(cb).toHaveBeenCalledWith(event);
  });

  it("dispatches to the latest callback after rerender without reconnecting", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    MockEventSource.instances[0]!.onmessage!({
      data: JSON.stringify({ type: "run:created", runId: "r2" }),
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ type: "run:created", runId: "r2" });
  });

  it("ignores malformed JSON without throwing", () => {
    const cb = vi.fn();
    renderHook(() => useSSE(cb));
    const src = MockEventSource.instances[0]!;
    expect(() => src.onmessage!({ data: "{not json" })).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
    expect(() => src.onerror!()).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const src = MockEventSource.instances[0]!;
    expect(src.close).not.toHaveBeenCalled();
    unmount();
    expect(src.close).toHaveBeenCalledTimes(1);
  });
});
