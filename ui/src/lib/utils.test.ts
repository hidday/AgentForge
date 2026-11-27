import { describe, it, expect } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

describe("cn", () => {
  it("joins plain class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values (undefined, null, false, empty string)", () => {
    expect(cn("a", undefined, null, false, "", "b")).toBe("a b");
  });

  it("resolves conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("merges conditional object syntax from clsx", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });

  it("returns an empty string when given no meaningful input", () => {
    expect(cn()).toBe("");
    expect(cn(undefined, null, false)).toBe("");
  });

  it("flattens arrays of class values", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });
});

describe("relativeTime", () => {
  it("returns 'just now' for a timestamp less than 60 seconds ago", () => {
    const date = new Date(Date.now() - 30 * 1000);
    expect(relativeTime(date)).toBe("just now");
  });

  it("returns 'just now' for the current instant (0 seconds elapsed)", () => {
    const date = new Date(Date.now());
    expect(relativeTime(date)).toBe("just now");
  });

  it("returns minutes-ago for a timestamp under an hour old", () => {
    const date = new Date(Date.now() - 5 * 60 * 1000);
    expect(relativeTime(date)).toBe("5m ago");
  });

  it("returns hours-ago for a timestamp under a day old", () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("3h ago");
  });

  it("returns days-ago for a timestamp a day or more old", () => {
    const date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("2d ago");
  });

  it("accepts an ISO date string as well as a Date object", () => {
    const iso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(relativeTime(iso)).toBe("10m ago");
  });

  it("is on the exact minute boundary (59s is 'just now', 60s is '1m ago')", () => {
    const almostMinute = new Date(Date.now() - 59 * 1000);
    expect(relativeTime(almostMinute)).toBe("just now");

    const exactlyMinute = new Date(Date.now() - 60 * 1000);
    expect(relativeTime(exactlyMinute)).toBe("1m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a Date object into a short month/day/time string", () => {
    const date = new Date("2026-03-05T08:09:07.000Z");
    const result = formatTimestamp(date);
    // Exact rendering is locale/timezone dependent in test environments, so
    // assert on the stable shape rather than an exact string: short month name,
    // a day number, and a colon-separated time with seconds.
    expect(result).toMatch(/^[A-Za-z]{3} \d{1,2}, \d{1,2}:\d{2}:\d{2}\s?(AM|PM)$/);
  });

  it("accepts an ISO date string as well as a Date object", () => {
    const iso = "2026-03-05T08:09:07.000Z";
    expect(formatTimestamp(iso)).toBe(formatTimestamp(new Date(iso)));
  });

  it("produces different output for different timestamps", () => {
    const a = formatTimestamp(new Date("2026-01-01T00:00:00.000Z"));
    const b = formatTimestamp(new Date("2026-06-15T12:30:45.000Z"));
    expect(a).not.toBe(b);
  });
});
