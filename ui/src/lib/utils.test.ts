import { describe, it, expect } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins plain class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    const isActive: boolean = false;
    expect(cn("a", isActive && "b", undefined, null, "c")).toBe("a c");
  });

  it("merges conflicting tailwind utility classes, keeping the last", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("returns an empty string when given no usable input", () => {
    expect(cn()).toBe("");
    expect(cn(false, undefined, null)).toBe("");
  });
});

describe("relativeTime", () => {
  const msAgo = (ms: number) => new Date(Date.now() - ms);

  it("returns 'just now' for a timestamp seconds in the past", () => {
    expect(relativeTime(msAgo(5_000))).toBe("just now");
  });

  it("returns 'just now' at the edge, just under one minute", () => {
    expect(relativeTime(msAgo(59_000))).toBe("just now");
  });

  it("returns minutes-ago for a timestamp minutes in the past", () => {
    expect(relativeTime(msAgo(5 * 60_000))).toBe("5m ago");
  });

  it("returns hours-ago for a timestamp hours in the past", () => {
    expect(relativeTime(msAgo(3 * 60 * 60_000))).toBe("3h ago");
  });

  it("returns days-ago for a timestamp days in the past", () => {
    expect(relativeTime(msAgo(2 * 24 * 60 * 60_000))).toBe("2d ago");
  });

  it("accepts an ISO string in addition to a Date object", () => {
    const iso = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(relativeTime(iso)).toBe("10m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date with month, day, hour, minute and second", () => {
    const result = formatTimestamp("2024-01-15T10:30:45.000Z");
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/15/);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("accepts a Date object as well as a string", () => {
    const date = new Date("2024-07-04T00:00:00.000Z");
    const result = formatTimestamp(date);
    expect(result).toMatch(/Jul/);
    expect(result).toMatch(/4/);
  });
});
