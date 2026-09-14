import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins multiple class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    const isHidden = false;
    expect(cn("px-2", isHidden && "hidden", null, undefined, "py-1")).toBe("px-2 py-1");
  });

  it("resolves conflicting tailwind utility classes, last one winning", () => {
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("returns an empty string when given nothing meaningful", () => {
    expect(cn()).toBe("");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports 'just now' just under the one-minute boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:01:00.000Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:01.000Z"))).toBe("just now");
  });

  it("reports minutes once at least 60 seconds have elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:01:00.000Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:00.000Z"))).toBe("1m ago");
  });

  it("stays in minutes just under the one-hour boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T01:00:00.000Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:01.000Z"))).toBe("59m ago");
  });

  it("reports hours once at least 60 minutes have elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T01:00:00.000Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:00.000Z"))).toBe("1h ago");
  });

  it("stays in hours just under the one-day boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-02T00:00:00.000Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:01.000Z"))).toBe("23h ago");
  });

  it("reports days once at least 24 hours have elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-03T00:00:00.000Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:00.000Z"))).toBe("2d ago");
  });

  it("accepts an ISO date string as well as a Date object", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:01:00.000Z"));
    expect(relativeTime("2024-01-01T00:00:00.000Z")).toBe("1m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a Date using month/day/hour/minute/second, no year", () => {
    const result = formatTimestamp(new Date("2024-03-15T14:30:45.000Z"));
    expect(result).toBe("Mar 15, 02:30:45 PM");
  });

  it("formats an ISO date string identically to the equivalent Date object", () => {
    const iso = "2024-03-15T14:30:45.000Z";
    expect(formatTimestamp(iso)).toBe(formatTimestamp(new Date(iso)));
  });
});
