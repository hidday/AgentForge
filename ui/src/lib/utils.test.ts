import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins truthy classes and drops falsy ones", () => {
    const enabled = (flag: boolean) => flag && "b";
    expect(cn("a", enabled(false), null, undefined, "c")).toBe("a c");
    expect(cn("a", enabled(true))).toBe("a b");
  });

  it("resolves conflicting tailwind classes with the last winning", () => {
    expect(cn("p-2 text-red-500", "p-4")).toBe("text-red-500 p-4");
  });
});

describe("relativeTime", () => {
  const NOW = new Date("2026-01-10T12:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it("returns 'just now' under a minute (boundary 59s)", () => {
    expect(relativeTime(ago(0))).toBe("just now");
    expect(relativeTime(ago(59_999))).toBe("just now");
  });

  it("returns minutes from 60s up to 59m", () => {
    expect(relativeTime(ago(60_000))).toBe("1m ago");
    expect(relativeTime(ago(59 * 60_000))).toBe("59m ago");
  });

  it("returns hours from 60m up to 23h", () => {
    expect(relativeTime(ago(60 * 60_000))).toBe("1h ago");
    expect(relativeTime(ago(23 * 3_600_000))).toBe("23h ago");
  });

  it("returns days at 24h and beyond", () => {
    expect(relativeTime(ago(24 * 3_600_000))).toBe("1d ago");
    expect(relativeTime(new Date(NOW - 5 * 86_400_000))).toBe("5d ago");
  });

  it("treats future dates as 'just now'", () => {
    expect(relativeTime(new Date(NOW + 10_000))).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats with month, day and time components", () => {
    const d = new Date(2026, 2, 7, 14, 5, 9);
    const out = formatTimestamp(d);
    expect(out).toContain("Mar");
    expect(out).toContain("7");
    expect(out).toMatch(/02:05:09\s?PM/);
  });

  it("accepts ISO strings equivalently to Date objects", () => {
    const d = new Date(2026, 0, 1, 9, 0, 0);
    expect(formatTimestamp(d.toISOString())).toBe(formatTimestamp(d));
  });
});
