import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/agents/promptRenderer.js";

describe("renderTemplate", () => {
  it("substitutes simple string variables", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("substitutes number and boolean values via String()", () => {
    expect(renderTemplate("count={{count}}", { count: 42 })).toBe("count=42");
    expect(renderTemplate("done={{done}}", { done: true })).toBe("done=true");
    expect(renderTemplate("done={{done}}", { done: false })).toBe("done=false");
  });

  it("renders null/undefined values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[]");
  });

  it("JSON-stringifies a plain object value that isn't an array", () => {
    const result = renderTemplate("{{obj}}", { obj: { a: 1, b: "two" } });
    expect(result).toBe('{"a":1,"b":"two"}');
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["a", "b"] });
    expect(result).toBe("1. a\n2. b");
  });

  it("renders an array of objects as bullet lists of their entries, JSON-stringifying nested object values", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "x1", meta: { nested: true } }],
    });
    expect(result).toContain("- id: x1");
    expect(result).toContain('- meta: {"nested":true}');
  });

  it("leaves the placeholder unresolved when an intermediate path segment is not an object", () => {
    // vars.issue is a string, so trying to walk "issue.title" hits a
    // non-object value partway through the path and must return the
    // original {{...}} placeholder unchanged.
    const result = renderTemplate("{{issue.title}}", { issue: "just a string" });
    expect(result).toBe("{{issue.title}}");
  });

  it("leaves the placeholder unresolved when the intermediate value is null", () => {
    const result = renderTemplate("{{a.b}}", { a: null });
    expect(result).toBe("{{a.b}}");
  });

  it("resolves nested dotted paths that stay within plain objects", () => {
    const result = renderTemplate("{{a.b}}", { a: { b: "deep value" } });
    expect(result).toBe("deep value");
  });
});
