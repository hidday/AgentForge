import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate()", () => {
  it("reads an existing prompt file from the prompts directory", () => {
    const content = loadPromptTemplate("planner.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the requested prompt file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate()", () => {
  it("substitutes a simple top-level string variable", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("substitutes a nested path variable", () => {
    expect(renderTemplate("{{a.b.c}}", { a: { b: { c: "deep" } } })).toBe("deep");
  });

  it("renders numbers and booleans as their string form", () => {
    expect(renderTemplate("{{n}} / {{b}}", { n: 42, b: true })).toBe("42 / true");
  });

  it("renders null/undefined values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", {})).toBe("[]");
  });

  it("JSON-stringifies a plain object value that isn't an array", () => {
    expect(renderTemplate("{{obj}}", { obj: { a: 1, b: "x" } })).toBe('{"a":1,"b":"x"}');
  });

  it("renders an array of primitives as a numbered list", () => {
    const out = renderTemplate("{{items}}", { items: ["first", "second"] });
    expect(out).toBe("1. first\n2. second");
  });

  it("renders an array of objects as bulleted key/value lines", () => {
    const out = renderTemplate("{{rows}}", { rows: [{ id: "a", label: "Alpha" }] });
    expect(out).toBe("  - id: a\n  - label: Alpha");
  });

  it("renders an array of objects whose values include numbers/booleans/nested objects", () => {
    const out = renderTemplate("{{rows}}", {
      rows: [{ count: 3, active: false, meta: { nested: 1 } }],
    });
    expect(out).toContain("- count: 3");
    expect(out).toContain("- active: false");
    expect(out).toContain('- meta: {"nested":1}');
  });

  it("renders an empty array as an empty string", () => {
    expect(renderTemplate("[{{items}}]", { items: [] })).toBe("[]");
  });

  it("leaves the placeholder literal when an intermediate path segment resolves to a non-object", () => {
    // `a` resolves to a string, so `.b` cannot be indexed into it.
    expect(renderTemplate("{{a.b}}", { a: "hello" })).toBe("{{a.b}}");
  });

  it("leaves the placeholder literal when an intermediate path segment is null", () => {
    expect(renderTemplate("{{a.b}}", { a: null })).toBe("{{a.b}}");
  });

  it("replaces multiple distinct placeholders in the same template", () => {
    const out = renderTemplate("{{greeting}}, {{name}}! Count: {{count}}", {
      greeting: "Hi",
      name: "Ada",
      count: 7,
    });
    expect(out).toBe("Hi, Ada! Count: 7");
  });

  it("trims whitespace inside the placeholder braces", () => {
    expect(renderTemplate("{{ name }}", { name: "Trimmed" })).toBe("Trimmed");
  });
});
